// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {ISwapRouter02} from "../interfaces/@uniswap/v3-periphery/ISwapRouter02.sol";
import {CommonErrors} from "../errors/CommonErrors.sol";

/**
 * @title SwapModule
 * @notice Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.
 * @dev Designed as an abstract contract for adapters to inherit.
 */
abstract contract SwapModule is CommonErrors {
    /// -------- Libraries -------- ///
    using SafeERC20 for IERC20;

    /// --------Structs-------- ///

    struct SwapInputLimitParams {
        bytes path;
        uint256 deadline;
        uint256 amountInMaximum;
    }

    struct SwapOutputLimitParams {
        bytes path;
        uint256 deadline;
        uint256 amountOutMinimum;
    }

    /// --------Constants-------- ///

    /**
     * @notice The address of the Uniswap V3 Router contract.
     * @dev This is immutable and set during contract deployment.
     */
    ISwapRouter public immutable UNISWAP_ROUTER;

    /// @notice Boolean indicating whether to use the Uniswap V3 SwapRouter 02
    bool public immutable USE_SWAP_ROUTER_02;

    /// --------Errors-------- ///

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

    error ZeroAmountInMaximum();

    error ZeroAmountOutMinimum();

    error InvalidSwapDeadline();

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SwapModule with the Uniswap V3 Router address.
     * @param _uniswapRouter The address of the Uniswap V3 Router contract.
     * @dev Reverts with {InvalidZeroAddress} if the provided address is zero.
     */
    constructor(address _uniswapRouter, bool useSwapRouter02) {
        if (_uniswapRouter == address(0)) revert InvalidZeroAddress();
        UNISWAP_ROUTER = ISwapRouter(_uniswapRouter);
        USE_SWAP_ROUTER_02 = useSwapRouter02;
    }

    /// --------Functions-------- ///

    /**
     * @notice Swaps tokens using Uniswap V3 to obtain borrow tokens for repayment.
     * @param params Struct containing swap parameters for exact output.
     * @return amountIn The amount of input tokens spent.
     * @dev Reverts with {ZeroAmountOut} if the output token amount is zero.
     * @dev Reverts with {EmptySwapPath} if the swap path provided is empty.
     */
    function _swapFlashloanToBorrowToken(
        ISwapRouter.ExactOutputParams memory params
    ) internal returns (uint256 amountIn) {
        if (params.amountOut == 0) revert ZeroAmountOut();
        if (params.path.length == 0) revert EmptySwapPath();
        if (params.amountInMaximum == 0) revert ZeroAmountInMaximum();
        if (params.deadline == 0 || params.deadline < block.timestamp) revert InvalidSwapDeadline();

        IERC20 tokenOut = _decodeTokenOut(params.path);
        _approveTokenForSwap(tokenOut);

        if (!USE_SWAP_ROUTER_02) {
            amountIn = UNISWAP_ROUTER.exactOutput(params);
        } else {
            ISwapRouter02.ExactOutputParams memory params02 = ISwapRouter02.ExactOutputParams({
                path: params.path,
                recipient: params.recipient,
                amountOut: params.amountOut,
                amountInMaximum: params.amountInMaximum
            });

            amountIn = ISwapRouter02(address(UNISWAP_ROUTER)).exactOutput(params02);
        }

        //    try UNISWAP_ROUTER.exactOutput(params) returns (uint256 returnedAmountIn) {
        //         // If the call was successful, we save the result
        //         amountIn = returnedAmountIn;
        //     } catch {
        //         // If calling exactOutput in ISwapRouter is not supported, try ISwapRouter02
        //         ISwapRouter02.ExactOutputParams memory params02 = ISwapRouter02.ExactOutputParams({
        //             path: params.path,
        //             recipient: params.recipient,
        //             amountOut: params.amountOut,
        //             amountInMaximum: params.amountInMaximum
        //         });

        //         try ISwapRouter02(address(UNISWAP_ROUTER)).exactOutput(params02) returns (uint256 returnedAmountIn02) {
        //             amountIn = returnedAmountIn02;
        //         } catch {
        //             // If both interfaces are not supported, call revert
        //             revert("Swap router does not support ISwapRouter or ISwapRouter02");
        //         }
        //     }

        _clearApprove(tokenOut);
    }

    /**
     * @notice Swaps collaterals into Compound-supported tokens.
     * @param params Struct containing swap parameters for exact input.
     * @return amountOut The amount of output tokens received.
     * @dev Reverts with {ZeroAmountIn} if the input token amount is zero.
     * @dev Reverts with {EmptySwapPath} if the swap path provided is empty.
     */
    function _swapCollateralToCompoundToken(
        ISwapRouter.ExactInputParams memory params
    ) internal returns (uint256 amountOut) {
        if (params.amountIn == 0) revert ZeroAmountIn();
        if (params.path.length == 0) revert EmptySwapPath();
        if (params.amountOutMinimum == 0) revert ZeroAmountOutMinimum();
        if (params.deadline == 0 || params.deadline < block.timestamp) revert InvalidSwapDeadline();

        IERC20 tokenIn = _decodeTokenIn(params.path);
        _approveTokenForSwap(tokenIn);

        if (!USE_SWAP_ROUTER_02) {
            amountOut = UNISWAP_ROUTER.exactInput(params);
        } else {
            ISwapRouter02.ExactInputParams memory params02 = ISwapRouter02.ExactInputParams({
                path: params.path,
                recipient: params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMinimum
            });

            amountOut = ISwapRouter02(address(UNISWAP_ROUTER)).exactInput(params02);
        }

        _clearApprove(tokenIn);
    }

    /// --------Internal Helper Functions-------- ///

    /**
     * @notice Approves the Uniswap router to spend an infinite amount of a token.
     * @param token The token to approve for spending.
     * @notice Approves the Uniswap router maximum allowance to spend a token.
     */
    function _approveTokenForSwap(IERC20 token) internal {
        token.forceApprove(address(UNISWAP_ROUTER), type(uint256).max);
    }

    /**
     * @notice Clears the approval of a token for the Uniswap router.
     * @param token The token to clear approval for.
     * @notice Clears the approval of a token for the Uniswap router.
     */
    function _clearApprove(IERC20 token) internal {
        token.forceApprove(address(UNISWAP_ROUTER), 0);
    }

    /**
     * @notice Decodes the input token address from the swap path.
     * @param path The swap path.
     * @return tokenIn Address of the input token.
     */
    function _decodeTokenIn(bytes memory path) internal pure returns (IERC20 tokenIn) {
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
    function _decodeTokenOut(bytes memory path) internal pure returns (IERC20 tokenOut) {
        assembly {
            // Load the length of the path
            let pathLength := mload(path)
            // Extract the last 20 bytes as tokenOut address
            tokenOut := mload(add(path, pathLength))
        }
    }
}
