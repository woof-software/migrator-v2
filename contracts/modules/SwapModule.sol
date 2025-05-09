// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/uniswap/v3-periphery/ISwapRouter.sol";
import {ISwapRouter02} from "../interfaces/uniswap/v3-periphery/ISwapRouter02.sol";
import {CommonErrors} from "../errors/CommonErrors.sol";

/**
 * @title SwapModule
 * @notice Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.
 * @dev Designed as an abstract contract for adapters to inherit. It includes helper functions for token swaps,
 *      approval management, and decoding swap paths. The module supports both the Uniswap V3 `exactInput` and
 *      `exactOutput` functions, as well as the SwapRouter02 interface.
 */
abstract contract SwapModule is CommonErrors {
    /// -------- Libraries -------- ///
    using SafeERC20 for IERC20;

    /// --------Structs-------- ///

    /**
     * @notice Parameters for a token swap with an exact output amount and a maximum input limit.
     *
     * @param path The encoded swap path specifying the token swap sequence.
     * @param deadline The timestamp by which the swap must be completed.
     * @param amountInMaximum The maximum amount of input tokens that can be spent during the swap.
     *
     * @dev This struct is used to define the parameters for a swap operation where the output token amount is fixed,
     *      and the input token amount must not exceed the specified maximum.
     */
    struct SwapInputLimitParams {
        bytes path;
        uint256 deadline;
        uint256 amountInMaximum;
    }

    /**
     * @notice Parameters for a token swap with an exact input amount and a minimum output limit.
     *
     * @param path The encoded swap path specifying the token swap sequence.
     * @param deadline The timestamp by which the swap must be completed.
     * @param amountOutMinimum The minimum amount of output tokens to be received.
     *
     * @dev This struct is used to define the parameters for a swap operation where the input token amount is fixed,
     *      and the output token amount must meet or exceed the specified minimum.
     */
    struct SwapOutputLimitParams {
        bytes path;
        uint256 deadline;
        uint256 amountOutMinimum;
    }

    /// --------Constants-------- ///

    /**
     * @notice The address of the Uniswap V3 Router contract.
     *
     * @dev This variable holds the address of the Uniswap V3 Router used for token swaps.
     *      It is immutable and set during the deployment of the `SwapModule` for gas efficiency and safety.
     */
    ISwapRouter public immutable UNISWAP_ROUTER;

    /**
     * @notice Boolean indicating whether to use the Uniswap V3 SwapRouter02 interface.
     *
     * @dev This variable determines whether the `SwapModule` uses the SwapRouter02 interface for token swaps.
     *      It is immutable and set during the deployment of the `SwapModule` for gas efficiency and safety.
     */
    bool public immutable USE_SWAP_ROUTER_02;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the input token amount is zero.
     *
     * @notice This error is triggered when a swap operation is attempted with an input amount of zero,
     *         which is invalid and would result in no tokens being swapped.
     */
    error ZeroAmountIn();

    /**
     * @dev Reverts if the output token amount is zero.
     *
     * @notice This error is triggered when a swap operation is attempted, but the resulting output token amount is zero,
     *         which is invalid and indicates that the swap did not produce any tokens.
     */
    error ZeroAmountOut();

    /**
     * @dev Reverts if the swap path provided is empty.
     *
     * @notice This error is triggered when a swap operation is attempted without specifying a valid token swap path,
     *         which is required for the Uniswap V3 router to execute the swap.
     */
    error EmptySwapPath();

    /**
     * @dev Reverts if the maximum input token amount (`amountInMaximum`) is zero.
     *
     * @notice This error is triggered when a swap operation is attempted with a maximum input amount of zero,
     *         which is invalid and would prevent the swap from being executed.
     */
    error ZeroAmountInMaximum();

    /**
     * @dev Reverts if the minimum output token amount (`amountOutMinimum`) is zero.
     *
     * @notice This error is triggered when a swap operation is attempted with a minimum output amount of zero,
     *         which is invalid and would prevent the swap from being executed successfully.
     */
    error ZeroAmountOutMinimum();

    /**
     * @dev Reverts if the swap deadline is invalid.
     *
     * @notice This error is triggered when a swap operation is attempted with a deadline that is either zero
     *         or has already passed, making the swap invalid.
     */
    error InvalidSwapDeadline();

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SwapModule with the Uniswap V3 Router address and configuration.
     *
     * @param _uniswapRouter The address of the Uniswap V3 Router contract.
     * @param useSwapRouter02 Boolean flag indicating whether to use Uniswap V3 SwapRouter02.
     *
     * @dev This constructor sets the Uniswap Router address and determines whether to use the SwapRouter02 interface.
     *      It ensures that the provided `_uniswapRouter` address is valid and non-zero.
     *
     * Requirements:
     * - `_uniswapRouter` must not be a zero address.
     *
     * Reverts:
     * - {InvalidZeroAddress} if `_uniswapRouter` is a zero address.
     */
    constructor(address _uniswapRouter, bool useSwapRouter02) {
        if (_uniswapRouter == address(0)) revert InvalidZeroAddress();
        UNISWAP_ROUTER = ISwapRouter(_uniswapRouter);
        USE_SWAP_ROUTER_02 = useSwapRouter02;
    }

    /// --------Functions-------- ///

    /**
     * @notice Swaps tokens obtained from a flash loan into the borrow token required for repayment.
     *
     * @param params Struct containing the following swap parameters for exact output:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `recipient`: The address that will receive the output tokens.
     *        - `amountOut`: The exact amount of output tokens to be received.
     *        - `amountInMaximum`: The maximum amount of input tokens that can be spent.
     *        - `deadline`: The timestamp by which the swap must be completed.
     * @param dustCollector The address to which any dust tokens will be sent after the swap.
     *
     * @return amountIn The amount of input tokens spent during the swap.
     *
     * @dev This function performs the following steps:
     *      1. Validates the swap parameters, including `amountOut`, `path`, `amountInMaximum`, and `deadline`.
     *      2. Decodes the output token from the swap path and approves it for the Uniswap router.
     *      3. Executes the swap using either the Uniswap V3 `exactOutput` function or the SwapRouter02 interface,
     *         depending on the `USE_SWAP_ROUTER_02` flag.
     *      4. Clears the token approval after the swap is completed.
     *
     * Requirements:
     * - `params.amountOut` must be greater than zero.
     * - `params.path` must not be empty.
     * - `params.amountInMaximum` must be greater than zero.
     * - `params.deadline` must be greater than the current block timestamp.
     *
     * Reverts:
     * - {ZeroAmountOut} if `params.amountOut` is zero.
     * - {EmptySwapPath} if `params.path` is empty.
     * - {ZeroAmountInMaximum} if `params.amountInMaximum` is zero.
     * - {InvalidSwapDeadline} if `params.deadline` is zero or has already passed.
     */
    function _swapFlashloanToBorrowToken(
        ISwapRouter.ExactOutputParams memory params,
        address dustCollector
    ) internal returns (uint256 amountIn) {
        if (params.amountOut == 0) revert ZeroAmountOut();
        if (params.path.length == 0) revert EmptySwapPath();
        if (params.amountInMaximum == 0) revert ZeroAmountInMaximum();
        if (params.deadline == 0 || params.deadline < block.timestamp) revert InvalidSwapDeadline();

        // Decode the connector tokens from the swap path
        IERC20[] memory connectorTokens = _decodeConnectorTokens(params.path);
        uint256[] memory balancesBefore = new uint256[](connectorTokens.length);
        // Store the initial balances of the connector tokens
        for (uint256 i = 0; i < connectorTokens.length; i++) {
            balancesBefore[i] = connectorTokens[i].balanceOf(address(this));
        }

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

        // Withdraw any dust tokens from the swap
        for (uint256 i = 0; i < connectorTokens.length; i++) {
            uint256 newBalance = connectorTokens[i].balanceOf(address(this));
            if (newBalance > balancesBefore[i]) {
                uint256 dust = newBalance - balancesBefore[i];
                if (dust > 0) {
                    connectorTokens[i].transfer(dustCollector, dust);
                }
            }
        }

        _clearApprove(tokenOut);
    }

    /**
     * @notice Swaps collateral tokens into Compound-supported tokens.
     *
     * @param params Struct containing the following swap parameters for exact input:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `recipient`: The address that will receive the output tokens.
     *        - `amountIn`: The exact amount of input tokens to be spent.
     *        - `amountOutMinimum`: The minimum amount of output tokens to be received.
     *        - `deadline`: The timestamp by which the swap must be completed.
     *
     * @return amountOut The amount of output tokens received during the swap.
     *
     * @dev This function performs the following steps:
     *      1. Validates the swap parameters, including `amountIn`, `path`, `amountOutMinimum`, and `deadline`.
     *      2. Decodes the input token from the swap path and approves it for the Uniswap router.
     *      3. Executes the swap using either the Uniswap V3 `exactInput` function or the SwapRouter02 interface,
     *         depending on the `USE_SWAP_ROUTER_02` flag.
     *      4. Clears the token approval after the swap is completed.
     *
     * Requirements:
     * - `params.amountIn` must be greater than zero.
     * - `params.path` must not be empty.
     * - `params.amountOutMinimum` must be greater than zero.
     * - `params.deadline` must be greater than the current block timestamp.
     *
     * Reverts:
     * - {ZeroAmountIn} if `params.amountIn` is zero.
     * - {EmptySwapPath} if `params.path` is empty.
     * - {ZeroAmountOutMinimum} if `params.amountOutMinimum` is zero.
     * - {InvalidSwapDeadline} if `params.deadline` is zero or has already passed.
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
     * @notice Decodes connector (intermediate) token addresses from a multi-hop swap path.
     * @param path The encoded swap path specifying the token swap sequence.
     * @return connectors Array of connector token addresses.
     *
     * @dev Returns an empty array if the path encodes only a single swap (i.e., no intermediate tokens).
     *      Uses inline assembly for efficient decoding.
     */
    function _decodeConnectorTokens(bytes memory path) internal pure returns (IERC20[] memory connectors) {
        uint256 pathLength = path.length;

        // Each hop = 20 (tokenIn) + 3 (fee) + 20 (tokenOut) = 43 bytes
        if (pathLength <= 43) {
            return new IERC20[](0); // Single path — no connectors
        }

        uint256 numConnectors = (pathLength - 43) / 23; // Calculate number of connectors
        connectors = new IERC20[](numConnectors);

        uint256 offset = 20; // skip tokenIn

        for (uint256 i = 0; i < numConnectors; ++i) {
            offset += 3; // skip fee
            address connector;
            assembly {
                // Read 32 bytes from path starting at offset and shift right by 96 bits to get the address (20 bytes)
                // 32 bytes = 256 bits, so we need to shift right by 256 - 160 = 96 bits
                connector := shr(96, mload(add(add(path, 32), offset)))
            }
            connectors[i] = IERC20(connector);
            offset += 20; // Move to next connector
        }
    }

    /**
     * @notice Approves the Uniswap router to spend an infinite amount of a specified token.
     * @param token The token to approve for spending.
     *
     * @dev This function sets the maximum allowance for the Uniswap router to spend the specified token.
     *      It is used to ensure that the router can execute swaps without running into allowance issues.
     *
     * Requirements:
     * - The `token` must be a valid ERC20 token.
     */
    function _approveTokenForSwap(IERC20 token) internal {
        token.forceApprove(address(UNISWAP_ROUTER), type(uint256).max);
    }

    /**
     * @notice Clears the approval of a token for the Uniswap router.
     * @param token The token to clear approval for.
     *
     * @dev This function sets the allowance of the specified token for the Uniswap router to zero.
     *      It is used to revoke the router's permission to spend the token after a swap operation is completed,
     *      ensuring better security and minimizing unnecessary token approvals.
     */
    function _clearApprove(IERC20 token) internal {
        token.forceApprove(address(UNISWAP_ROUTER), 0);
    }

    /**
     * @notice Decodes the input token address from the swap path.
     * @param path The encoded swap path specifying the token swap sequence.
     * @return tokenIn The address of the input token.
     *
     * @dev This function extracts the first 20 bytes of the provided swap path to determine the input token address.
     *      It uses inline assembly for efficient decoding.
     *
     * Requirements:
     * - The `path` must be a valid encoded swap path with a minimum length of 20 bytes.
     */
    function _decodeTokenIn(bytes memory path) internal pure returns (IERC20 tokenIn) {
        assembly {
            // Extract the first 20 bytes as the tokenIn address
            tokenIn := mload(add(path, 20))
        }
    }

    /**
     * @notice Decodes the output token address from the swap path.
     * @param path The encoded swap path specifying the token swap sequence.
     * @return tokenOut The address of the output token.
     *
     * @dev This function extracts the last 20 bytes of the provided swap path to determine the output token address.
     *      It uses inline assembly for efficient decoding.
     *
     * Requirements:
     * - The `path` must be a valid encoded swap path with a minimum length of 20 bytes.
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
