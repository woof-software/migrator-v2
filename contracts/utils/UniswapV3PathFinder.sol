// SPDX-License-Identifier: MIT
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
    struct QuoteSwapParams {
        bytes path;
        uint256 amountIn;
        uint256 amountOut;
        uint256 maxGasEstimate;
    }

    struct SingleSwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        address excludedPool;
        uint256 maxGasEstimate;
    }

    struct MultiSwapParams {
        address tokenIn;
        address tokenOut;
        address[] connectors;
        uint256 amountIn;
        uint256 amountOut;
        address excludedPool;
        uint256 maxGasEstimate;
    }

    uint256[] public availableFeeTiers = [100, 500, 3000, 10000];
    address public factory;
    address public quoterV2;

    error SwapPoolsNotFound();
    error MustBeAtLeastOneConnector();
    error MustBeSetAmountInOrAmountOut();
    error OnlyOneAmountMustBeSet();
    error MustBeSetMaxGasEstimate();

    constructor(address _factory, address _quoterV2) {
        factory = _factory;
        quoterV2 = _quoterV2;
    }

    function getBestSingleSwapPath(
        SingleSwapParams memory params
    ) external returns (bytes memory path, uint256 estimatedAmount, uint256 gasEstimate) {
        SingleSwapParams memory params_ = params;
        bool exactInput = params_.amountIn > 0;

        (path, estimatedAmount, gasEstimate) = _getBestSingleSwapPath(
            SingleSwapParams({
                tokenIn: params_.tokenIn,
                tokenOut: params_.tokenOut,
                amountIn: params_.amountIn,
                amountOut: params_.amountOut,
                excludedPool: params_.excludedPool,
                maxGasEstimate: params_.maxGasEstimate
            }),
            exactInput
        );

        if (estimatedAmount == 0) revert SwapPoolsNotFound();
    }

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
                true // set "true" because we don't want to switch the tokenIn and tokenOut in the formatSinglePath function for multi-swap
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

            if (bestAmount > estimatedAmount) {
                estimatedAmount = bestAmount;
                path = bestPath;
                gasEstimate = gasEstimate_;
            }
        }

        if (estimatedAmount == 0) revert SwapPoolsNotFound();
    }

    function _getBestSingleSwapPath(
        SingleSwapParams memory params,
        bool exactInput
    ) internal returns (bytes memory singlePath, uint256 estimatedAmount, uint256 gasEstimate) {
        SingleSwapParams memory params_ = params;

        for (uint256 i = 0; i < availableFeeTiers.length; ++i) {
            uint24 fee = uint24(availableFeeTiers[i]);
            address pool = IUniswapV3Factory(factory).getPool(params_.tokenIn, params_.tokenOut, fee);

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

            if (estimatedAmount_ > estimatedAmount) {
                estimatedAmount = estimatedAmount_;
                singlePath = path_;
                gasEstimate = gasEstimate_;
            }
        }
    }

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
            address pool = IUniswapV3Factory(factory).getPool(connectorTokenIn, tokenOut_, fee);

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

            if (estimatedAmount_ > estimatedAmount) {
                estimatedAmount = estimatedAmount_;
                multiPath = multiPath_;
                gasEstimate = gasEstimate_;
            }
        }
    }

    function _quoteSwap(QuoteSwapParams memory params) internal returns (uint256 estimatedAmount, uint256 gasEstimate) {
        QuoteSwapParams memory params_ = params;

        if (params_.amountIn == 0 && params_.amountOut == 0) revert MustBeSetAmountInOrAmountOut();
        if (params_.amountIn > 0 && params_.amountOut > 0) revert OnlyOneAmountMustBeSet();
        if (params_.maxGasEstimate == 0) revert MustBeSetMaxGasEstimate();

        if (params_.amountIn > 0) {
            try
                IQuoterV2(quoterV2).quoteExactInput{gas: params_.maxGasEstimate}(params_.path, params_.amountIn)
            returns (uint256 amountOut_, uint160[] memory, uint32[] memory, uint256 gasEstimate_) {
                estimatedAmount = amountOut_;
                gasEstimate = gasEstimate_;
            } catch {
                return (0, 0);
            }
        } else {
            try
                IQuoterV2(quoterV2).quoteExactOutput{gas: params_.maxGasEstimate}(params_.path, params_.amountOut)
            returns (uint256 amountIn_, uint160[] memory, uint32[] memory, uint256 gasEstimate_) {
                estimatedAmount = amountIn_;
                gasEstimate = gasEstimate_;
            } catch {
                return (0, 0);
            }
        }
    }

    function _extractConnectorToken(bytes memory path) internal pure returns (address lastToken) {
        assembly {
            // Extract the first 20 bytes as the tokenIn address
            lastToken := mload(add(path, 20))
        }
    }

    function _devBytesToHexString(bytes memory data) internal pure returns (string memory) {
        bytes16 HEX_SYMBOLS = "0123456789abcdef";
        uint256 length = data.length;
        bytes memory buffer = new bytes(2 * length + 2);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 0; i < length; i++) {
            buffer[2 + i * 2] = HEX_SYMBOLS[uint8(data[i]) >> 4];
            buffer[3 + i * 2] = HEX_SYMBOLS[uint8(data[i]) & 0x0f];
        }
        return string(buffer);
    }
}
