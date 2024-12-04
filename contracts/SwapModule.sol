// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapRouter} from "./interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {IERC20NonStandard} from "./interfaces/IERC20NonStandard.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SwapModule
 * @notice Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.
 * @dev Designed as an abstract contract for adapters to inherit.
 */
abstract contract SwapModule is ReentrancyGuard {
    /// --------Structs-------- ///
    
    struct Swap {
        bytes path;
        uint256 amountInMaximum;
    }

    /// --------Constants-------- ///

    /**
     * @notice Maximum allowable basis points (BPS) for slippage calculations.
     * @dev 1 BPS = 0.01%, so 10,000 BPS represents 100%.
     */
    uint256 public constant MAX_BPS = 10_000;

    /**
     * @notice The address of the Uniswap V3 Router contract.
     * @dev This is immutable and set during contract deployment.
     */
    ISwapRouter public immutable UNISWAP_ROUTER;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if an address provided is zero.
     */
    error InvalidZeroAddress();

    /**
     * @dev Reverts if a swap operation fails.
     */
    error SwapFailed();

    /**
     * @dev Reverts if an invalid slippage basis points value is provided.
     * @param slippageBps The provided slippage BPS value.
     */
    error InvalidSlippageBps(uint256 slippageBps);

    /**
     * @dev Reverts if the input token amount is zero.
     */
    error ZeroAmountIn();

    /**
     * @dev Reverts if the output token amount is zero.
     */
    error ZeroAmountOut();

    /**
     * @dev Reverts if the swap path provided is empty.
     */
    error EmptySwapPath();

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SwapModule with the Uniswap V3 Router address.
     * @param _uniswapRouter The address of the Uniswap V3 Router contract.
     * @dev Reverts with {InvalidZeroAddress} if the provided address is zero.
     */
    constructor(address _uniswapRouter) {
        if (_uniswapRouter == address(0)) revert InvalidZeroAddress();
        UNISWAP_ROUTER = ISwapRouter(_uniswapRouter);
    }

    /// --------Functions-------- ///

    /**
     * @notice Swaps tokens using Uniswap V3 to obtain borrow tokens for repayment.
     * @param params Struct containing swap parameters for exact output.
     * @return amountIn The amount of input tokens spent.
     * @dev Reverts with {ZeroAmountOut} if the output token amount is zero.
     * @dev Reverts with {EmptySwapPath} if the swap path provided is empty.
     * @dev Reverts with {SwapFailed} if the swap operation fails.
     */
    function _swapFlashloanToBorrowToken(
        ISwapRouter.ExactOutputParams memory params
    ) internal nonReentrant returns (uint256 amountIn) {
        if (params.amountOut == 0) revert ZeroAmountOut();
        if (params.path.length == 0) revert EmptySwapPath();

        // Perform the swap
        amountIn = UNISWAP_ROUTER.exactOutput(params);
    }

    /**
     * @notice Swaps collaterals into Compound-supported tokens.
     * @param params Struct containing swap parameters for exact input.
     * @return amountOut The amount of output tokens received.
     * @dev Reverts with {ZeroAmountIn} if the input token amount is zero.
     * @dev Reverts with {EmptySwapPath} if the swap path provided is empty.
     * @dev Reverts with {SwapFailed} if the swap operation fails.
     */
    function _swapCollateralToCompoundToken(
        ISwapRouter.ExactInputParams memory params
    ) internal nonReentrant returns (uint256 amountOut) {
        if (params.amountIn == 0) revert ZeroAmountIn();
        if (params.path.length == 0) revert EmptySwapPath();

        // Perform the swap
        amountOut = UNISWAP_ROUTER.exactInput(params);
    }

    /**
     * @notice Calculates the maximum allowable slippage amount based on a given percentage in BPS (Basis Points).
     * @param amount The original amount to calculate slippage on.
     * @param slippageBps The allowed slippage in Basis Points (BPS), where 10,000 BPS equals 100%.
     * @return slippageAmount The allowable amount of tokens for slippage.
     * @dev Reverts with {InvalidSlippageBps} if the provided `slippageBps` exceeds the maximum allowable BPS (MAX_BPS).
     */
    function _calculateSlippageAmount(
        uint256 amount,
        uint256 slippageBps
    ) internal pure returns (uint256 slippageAmount) {
        if (slippageBps > MAX_BPS) revert InvalidSlippageBps(slippageBps);

        // Calculate the amount of slippage
        slippageAmount = (amount * (MAX_BPS - slippageBps)) / MAX_BPS;
    }

    /// --------Internal Helper Functions-------- ///

    /**
     * @notice Approves a token for the Uniswap router.
     * @param token The token to approve.
     * @param amount The amount of tokens to approve.
     */
    function _approveTokenForSwap(IERC20NonStandard token, uint256 amount) internal {
        token.approve(address(UNISWAP_ROUTER), amount);
    }

    /**
     * @notice Decodes the input token address from the swap path.
     * @param path The swap path.
     * @return tokenIn Address of the input token.
     */
    function _decodeTokenIn(bytes memory path) internal pure returns (address tokenIn) {
        assembly {
            // Extract the first 20 bytes as the tokenIn address
            tokenIn := mload(add(path, 20))
        }
    }

    /**
     * @notice Decodes the output token address from the swap path.
     * @param path The swap path.
     * @return tokenOut Address of the output token.
     */
    function _decodeTokenOut(bytes memory path) internal pure returns (address tokenOut) {
        assembly {
            // Load the length of the path
            let pathLength := mload(path)
            // Extract the last 20 bytes as tokenOut address
            tokenOut := mload(add(path, add(20, pathLength)))
        }
    }
}
