// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapRouter} from "./interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {IERC20NonStandard} from "./interfaces/IERC20NonStandard.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SwapModule
 * @notice This contract provides swap functionality using Uniswap V3 for non-standard ERC-20 tokens.
 * @dev Designed to be inherited by adapters requiring token swap functionality.
 */
contract SwapModule is ReentrancyGuard {
    /// --------Errors-------- ///

    /**
     * @dev Reverts if the token transfer approval fails.
     */
    error ApprovalFailed(address token, uint256 amount);

    /**
     * @dev Reverts if any address parameter is zero.
     */
    error InvalidZeroAddress();

    /**
     * @dev Reverts if the swap operation fails.
     */
    error SwapFailed();

    /**
     * @dev Reverts if the token transfer fails.
     */
    error TransferFailed(address token, address to, uint256 amount);

    /// --------State Variables-------- ///

    /**
     * @notice Address of the Uniswap V3 Router.
     */
    ISwapRouter public immutable UNISWAP_ROUTER;

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SwapModule with the Uniswap V3 Router address.
     * @param _uniswapRouter Address of the Uniswap V3 Router.
     */
    constructor(address _uniswapRouter) {
        if (_uniswapRouter == address(0)) revert InvalidZeroAddress();
        UNISWAP_ROUTER = ISwapRouter(_uniswapRouter);
    }

    /// --------Functions-------- ///

    function swapExactInputSingle(
        ISwapRouter.ExactInputSingleParams memory params
    ) external nonReentrant returns (uint256 amountOut) {
        if (
            params.amountIn == 0 ||
            params.amountOutMinimum == 0 ||
            params.tokenIn == address(0) ||
            params.tokenOut == address(0)
        ) {
            revert SwapFailed();
        }

        // // Transfer input tokens to the contract // @TODO: to transfer tokens ??
        // IERC20NonStandard(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        // Approve the router to spend the tokens
        IERC20NonStandard(params.tokenIn).approve(address(UNISWAP_ROUTER), params.amountIn);

        // Perform the swap
        try UNISWAP_ROUTER.exactInputSingle(params) returns (uint256 outputAmount) {
            amountOut = outputAmount;
        } catch {
            revert SwapFailed();
        }
    }

    function swapExactInput(
        ISwapRouter.ExactInputParams memory params
    ) external nonReentrant returns (uint256 amountOut) {
        if (
            params.amountIn == 0 ||
            params.amountOutMinimum == 0 ||
            params.path.length == 0 ||
            params.recipient == address(0)
        ) {
            revert SwapFailed();
        }

        // Decode the input token address from the path
        address tokenIn = _decodeTokenIn(params.path);

        // @TODO: add transferFrom if needed to transfer tokens
        // Approve the router to spend the tokens
        IERC20NonStandard(tokenIn).approve(address(UNISWAP_ROUTER), params.amountIn);

        // Perform the swap
        try UNISWAP_ROUTER.exactInput(params) returns (uint256 outputAmount) {
            amountOut = outputAmount;
        } catch {
            revert SwapFailed();
        }
    }

    function swapExactOutput(
        ISwapRouter.ExactOutputParams memory params
    ) external nonReentrant returns (uint256 amountIn) {
        if (params.amountOut == 0 || params.amountInMaximum == 0 || params.path.length == 0) {
            revert SwapFailed();
        }

        // Decode the input token address from the path
        address tokenIn = _decodeTokenIn(params.path);

        // @TODO: add transferFrom if needed to transfer tokens
        // Approve the router to spend the tokens
        IERC20NonStandard(tokenIn).approve(address(UNISWAP_ROUTER), params.amountInMaximum);

        // Perform the swap
        try UNISWAP_ROUTER.exactOutput(params) returns (uint256 inputAmount) {
            // Refund unused tokens
            if (params.amountInMaximum > inputAmount) {
                if (
                    !_doTransferOut(
                        IERC20NonStandard(tokenIn),
                        msg.sender,
                        params.amountInMaximum - inputAmount
                    )
                ) {
                    revert TransferFailed(
                        tokenIn,
                        msg.sender,
                        params.amountInMaximum - inputAmount
                    );
                }
            }
            amountIn = inputAmount;
        } catch {
            revert SwapFailed();
        }
    }

    /// --------Private Functions-------- ///

    /**
     * @notice Decodes the input token address from the swap path.
     * @param path The swap path.
     * @return tokenIn Address of the input token.
     */
    function _decodeTokenIn(bytes memory path) private pure returns (address tokenIn) {
        assembly {
            tokenIn := mload(add(path, 20)) // Read the first 20 bytes
        }
    }

    /**
     * @notice Handles token transfers while supporting both standard and non-standard ERC-20 tokens.
     * @param asset The ERC-20 token to transfer out.
     * @param to The recipient of the token transfer.
     * @param amount The amount of tokens to transfer.
     * @return success Boolean indicating the success of the transfer.
     * @dev Safely handles tokens that do not return a success value on transfer.
     */
    function _doTransferOut(
        IERC20NonStandard asset,
        address to,
        uint256 amount
    ) private returns (bool success) {
        asset.transfer(to, amount);

        assembly {
            switch returndatasize()
            case 0 {
                // Non-standard ERC-20: no return value, assume success.
                success := not(0) // Set success to true.
            }
            case 32 {
                // Standard ERC-20: return value is a single boolean.
                returndatacopy(0, 0, 32)
                success := mload(0) // Load the return value into success.
            }
            default {
                // Invalid ERC-20: unexpected return data size.
                revert(0, 0)
            }
        }
    }
}
