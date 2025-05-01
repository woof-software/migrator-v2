// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

interface IQuoterV2 {
    function quoteExactInput(
        bytes memory path,
        uint256 amountIn
    )
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );

    function quoteExactOutput(
        bytes memory path,
        uint256 amountOut
    )
        external
        returns (
            uint256 amountIn,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

contract UniswapV3PathFinder {
    // ----------------- Types -----------------

    /// @notice Parameters for quoting a swap.
    struct QuoteSwapParams {
        bytes path; ///< Encoded swap path.
        uint256 amountIn; ///< Amount of input tokens.
        uint256 amountOut; ///< Amount of output tokens.
        uint256 maxGasEstimate; ///< Maximum gas estimate for the swap.
    }

    /// @notice Parameters for a single swap.
    struct SingleSwapParams {
        address tokenIn; ///< Address of the input token.
        address tokenOut; ///< Address of the output token.
        uint256 amountIn; ///< Amount of input tokens.
        uint256 amountOut; ///< Amount of output tokens.
        address excludedPool; ///< Address of a pool to be excluded.
        uint256 maxGasEstimate; ///< Maximum gas estimate allowed.
    }

    /// @notice Parameters for a multi-hop swap.
    struct MultiSwapParams {
        address tokenIn; ///< Address of the input token.
        address tokenOut; ///< Address of the output token.
        address[] connectors; ///< Array of intermediate tokens.
        uint256 amountIn; ///< Amount of input tokens.
        uint256 amountOut; ///< Amount of output tokens.
        address excludedPool; ///< Address of a pool to be excluded.
        uint256 maxGasEstimate; ///< Maximum gas estimate allowed.
    }

    // ----------------- Storage -----------------

    /// @notice Address of the DAI token.
    address public immutable DAI;

    /// @notice Address of the USDS token.
    address public immutable USDS;

    /// @notice Address of the Uniswap V3 Factory contract.
    address public immutable FACTORY;

    /// @notice Address of the Uniswap V3 Quoter V2 contract.
    address public immutable QUOTER_V2;

    /// @notice Available Uniswap V3 fee tiers.
    uint256[] public availableFeeTiers = [100, 500, 3000, 10000];

    // ----------------- Errors -----------------

    /// @notice Error thrown when an address is zero.
    error InvalidZeroAddress();

    /// @notice Error thrown when no swap pools are found.
    error SwapPoolsNotFound();

    /// @notice Error thrown when no connector tokens are provided.
    error MustBeAtLeastOneConnector();

    /// @notice Error thrown when neither amountIn nor amountOut is specified.
    error MustBeSetAmountInOrAmountOut();

    /// @notice Error thrown when both amountIn and amountOut are specified.
    error OnlyOneAmountMustBeSet();

    /// @notice Error thrown when maxGasEstimate is not set.
    error MustBeSetMaxGasEstimate();

    /// @notice Error thrown for an invalid contract configuration.
    error InvalidConfiguration();

    // ----------------- Constructor -----------------

    /**
     * @notice Constructor to initialize the contract.
     * @param _factory Address of the Uniswap V3 Factory contract.
     * @param _quoterV2 Address of the Uniswap V3 QuoterV2 contract.
     * @param _dai Address of the DAI token.
     * @param _usds Address of the USDS token.
     */
    constructor(address _factory, address _quoterV2, address _dai, address _usds) {
        if (_factory == address(0) || _quoterV2 == address(0)) revert InvalidZeroAddress();

        if ((_dai == address(0) && _usds != address(0)) || (_dai != address(0) && _usds == address(0)))
            revert InvalidConfiguration();

        FACTORY = _factory;
        QUOTER_V2 = _quoterV2;
        DAI = _dai;
        USDS = _usds;
    }

    // ----------------- External Functions -----------------

    /**
     * @notice Finds the best single-hop swap path for a given input and output token.
     * @param params The parameters for the single swap.
     * @return path Encoded swap path.
     * @return estimatedAmount Estimated amount after swap.
     * @return gasEstimate Estimated gas required for the swap.
     */
    function getBestSingleSwapPath(
        SingleSwapParams memory params
    ) external returns (bytes memory path, uint256 estimatedAmount, uint256 gasEstimate) {
        SingleSwapParams memory params_ = params;
        bool exactInput = params_.amountIn > 0;

        if (params_.tokenIn == DAI && params_.tokenOut == USDS) {
            return (abi.encodePacked(DAI, USDS), exactInput ? params_.amountIn : params_.amountOut, 0);
        } else if (params_.tokenIn == USDS && params_.tokenOut == DAI) {
            return (abi.encodePacked(USDS, DAI), exactInput ? params_.amountIn : params_.amountOut, 0);
        }

        (path, estimatedAmount, gasEstimate) = _getBestSingleSwapPath(params_, exactInput);

        if (estimatedAmount == 0) revert SwapPoolsNotFound();
    }

    /**
     * @notice Finds the best multi-hop swap path for a given input and output token.
     * @param params The parameters for the multi swap.
     * @return path Encoded swap path.
     * @return estimatedAmount Estimated amount after swap.
     * @return gasEstimate Estimated gas required for the swap.
     */
    function getBestMultiSwapPath(
        MultiSwapParams memory params
    ) external returns (bytes memory path, uint256 estimatedAmount, uint256 gasEstimate) {
        MultiSwapParams memory params_ = params;

        if (params_.connectors.length == 0) revert MustBeAtLeastOneConnector();
        bool exactInput = params_.amountIn > 0;

        bytes[] memory _connectorPaths = new bytes[](params.connectors.length);

        for (uint256 i = 0; i < params.connectors.length; ++i) {
            if (params_.connectors[i] == params_.tokenIn || params_.connectors[i] == params_.tokenOut) continue;

            (_connectorPaths[i], , ) = _getBestSingleSwapPath(
                SingleSwapParams({
                    tokenIn: exactInput ? params_.tokenIn : params_.tokenOut,
                    tokenOut: params_.connectors[i],
                    amountIn: params_.amountIn,
                    amountOut: params_.amountOut,
                    excludedPool: params_.excludedPool,
                    maxGasEstimate: params_.maxGasEstimate
                }),
                true ///< Set "true" because we don't want to switch the tokenIn and tokenOut in the formatSinglePath function for multi-swap
            );
        }

        for (uint256 i = 0; i < _connectorPaths.length; ++i) {
            (bytes memory bestPath, uint256 bestAmount, uint256 gasEstimate_) = _getBestMultiSwapPath(
                exactInput,
                _connectorPaths[i],
                exactInput ? params_.tokenOut : params_.tokenIn,
                exactInput ? params_.amountIn : params_.amountOut,
                params_.excludedPool,
                params_.maxGasEstimate
            );

            if ((bestAmount != 0 && estimatedAmount == 0) || (exactInput && estimatedAmount < bestAmount)) {
                estimatedAmount = bestAmount;
                path = bestPath;
                gasEstimate = gasEstimate_;
            } else if (!exactInput && bestAmount != 0 && estimatedAmount > bestAmount) {
                estimatedAmount = bestAmount;
                path = bestPath;
                gasEstimate = gasEstimate_;
            }
        }

        if (estimatedAmount == 0) revert SwapPoolsNotFound();
    }

    // ----------------- Internal Functions -----------------

    /**
     * @notice Internal function to find the best single-hop swap path.
     * @param params The parameters for the single swap.
     * @param exactInput Boolean flag indicating if the swap is exact input or output.
     * @return singlePath The best single-hop swap path.
     * @return estimatedAmount The estimated amount received from the swap.
     * @return gasEstimate The estimated gas required for the swap.
     */
    function _getBestSingleSwapPath(
        SingleSwapParams memory params,
        bool exactInput
    ) internal returns (bytes memory singlePath, uint256 estimatedAmount, uint256 gasEstimate) {
        SingleSwapParams memory params_ = params;

        for (uint256 i = 0; i < availableFeeTiers.length; ++i) {
            uint24 fee = uint24(availableFeeTiers[i]);
            address pool = IUniswapV3Factory(FACTORY).getPool(params_.tokenIn, params_.tokenOut, fee);

            if (pool == address(0) || pool == params_.excludedPool) continue;

            bytes memory path_ = _formatSinglePath(exactInput, params_.tokenIn, params_.tokenOut, fee);

            (uint256 estimatedAmount_, uint256 gasEstimate_) = _quoteSwap(
                QuoteSwapParams({
                    path: path_,
                    amountIn: params_.amountIn,
                    amountOut: params_.amountOut,
                    maxGasEstimate: params_.maxGasEstimate
                })
            );

            if ((estimatedAmount_ != 0 && estimatedAmount == 0) || (exactInput && estimatedAmount < estimatedAmount_)) {
                estimatedAmount = estimatedAmount_;
                singlePath = path_;
                gasEstimate = gasEstimate_;
            } else if (!exactInput && estimatedAmount_ != 0 && estimatedAmount > estimatedAmount_) {
                estimatedAmount = estimatedAmount_;
                singlePath = path_;
                gasEstimate = gasEstimate_;
            }
        }
    }

    /**
     * @notice Internal function to find the best multi-hop swap path.
     * @param exactInput Boolean flag indicating if the swap is exact input or output.
     * @param bestSinglePath The best single-hop swap path identified.
     * @param tokenOut The output token address.
     * @param amount The amount to swap.
     * @param excludedPool Address of the pool to be excluded.
     * @param maxGasEstimate The maximum gas estimate allowed.
     * @return multiPath The best multi-hop swap path.
     * @return estimatedAmount The estimated amount received from the swap.
     * @return gasEstimate The estimated gas required for the swap.
     */
    function _getBestMultiSwapPath(
        bool exactInput,
        bytes memory bestSinglePath,
        address tokenOut,
        uint256 amount,
        address excludedPool,
        uint256 maxGasEstimate
    ) internal returns (bytes memory multiPath, uint256 estimatedAmount, uint256 gasEstimate) {
        bytes memory bestSinglePath_ = bestSinglePath;
        address tokenOut_ = tokenOut;
        uint256 amount_ = amount;
        uint256 maxGasEstimate_ = maxGasEstimate;

        if (bestSinglePath_.length == 0) return (new bytes(0), 0, 0);

        bool exactInput_ = exactInput;
        address connectorTokenIn = _extractConnectorToken(bestSinglePath_);

        for (uint256 i = 0; i < availableFeeTiers.length; ++i) {
            uint24 fee = uint24(availableFeeTiers[i]);
            address pool = IUniswapV3Factory(FACTORY).getPool(connectorTokenIn, tokenOut_, fee);

            if (pool == address(0) || pool == excludedPool) continue;

            bytes memory multiPath_ = abi.encodePacked(bestSinglePath_, fee, tokenOut_);

            (uint256 estimatedAmount_, uint256 gasEstimate_) = _quoteSwap(
                QuoteSwapParams({
                    path: multiPath_,
                    amountIn: exactInput_ ? amount_ : 0,
                    amountOut: exactInput_ ? 0 : amount_,
                    maxGasEstimate: maxGasEstimate_
                })
            );

            if (
                (estimatedAmount_ != 0 && estimatedAmount == 0) || (exactInput_ && estimatedAmount < estimatedAmount_)
            ) {
                estimatedAmount = estimatedAmount_;
                multiPath = multiPath_;
                gasEstimate = gasEstimate_;
            } else if (!exactInput_ && estimatedAmount_ != 0 && estimatedAmount > estimatedAmount_) {
                estimatedAmount = estimatedAmount_;
                multiPath = multiPath_;
                gasEstimate = gasEstimate_;
            }
        }
    }

    /**
     * @notice Internal function to quote a swap.
     * @dev Determines the estimated amount and gas cost for a given swap path.
     * @param params The parameters required for quoting a swap.
     * @return estimatedAmount The estimated amount after swap.
     * @return gasEstimate The estimated gas required for the swap.
     */
    function _quoteSwap(QuoteSwapParams memory params) internal returns (uint256 estimatedAmount, uint256 gasEstimate) {
        QuoteSwapParams memory params_ = params;

        if (params_.amountIn == 0 && params_.amountOut == 0) revert MustBeSetAmountInOrAmountOut();
        if (params_.amountIn > 0 && params_.amountOut > 0) revert OnlyOneAmountMustBeSet();
        if (params_.maxGasEstimate == 0) revert MustBeSetMaxGasEstimate();

        if (params_.amountIn > 0) {
            try
                IQuoterV2(QUOTER_V2).quoteExactInput{gas: params_.maxGasEstimate}(params_.path, params_.amountIn)
            returns (uint256 amountOut_, uint160[] memory, uint32[] memory, uint256 gasEstimate_) {
                estimatedAmount = amountOut_;
                gasEstimate = gasEstimate_;
            } catch {
                return (0, 0);
            }
        } else {
            try
                IQuoterV2(QUOTER_V2).quoteExactOutput{gas: params_.maxGasEstimate}(params_.path, params_.amountOut)
            returns (uint256 amountIn_, uint160[] memory, uint32[] memory, uint256 gasEstimate_) {
                estimatedAmount = amountIn_;
                gasEstimate = gasEstimate_;
            } catch {
                return (0, 0);
            }
        }
    }

    /**
     * @notice Internal function to format the swap path for single-hop swaps.
     * @param exactInput Boolean flag indicating if the swap is exact input or output.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param fee Fee tier for the Uniswap pool.
     * @return path Encoded swap path.
     */
    function _formatSinglePath(
        bool exactInput,
        address tokenIn,
        address tokenOut,
        uint24 fee
    ) internal pure returns (bytes memory path) {
        if (exactInput) {
            path = abi.encodePacked(tokenIn, fee, tokenOut);
        } else {
            path = abi.encodePacked(tokenOut, fee, tokenIn);
        }
    }

    /**
     * @notice Extracts the last token in a given encoded swap path.
     * @param path The encoded swap path.
     * @return lastToken The last token in the path.
     */
    function _extractConnectorToken(bytes memory path) internal pure returns (address lastToken) {
        assembly {
            // Load the length of the path
            let pathLength := mload(path)
            // Extract the last 20 bytes as tokenOut address
            lastToken := mload(add(path, pathLength))
        }
    }
}
