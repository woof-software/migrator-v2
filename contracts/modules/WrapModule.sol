// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {CommonErrors} from "../errors/CommonErrors.sol";

abstract contract WrapModule is CommonErrors {
    /// --------Constants-------- ///

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @notice Address of the wrapped native token (e.g., WETH).
     */
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

    /// --------Errors-------- ///

    error WrappingFailed(uint256 expectedAmount, uint256 actualAmount);

    error UnwrappingFailed(uint256 expectedAmount, uint256 actualAmount);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.
     * @param _wrappedNativeToken Address of the wrapped native token (e.g., WETH).
     */
    constructor(address _wrappedNativeToken) {
        if (_wrappedNativeToken == address(0)) {
            revert InvalidZeroAddress();
        }

        WRAPPED_NATIVE_TOKEN = IWETH9(_wrappedNativeToken);
    }

    /// --------Functions-------- ///

    /**
     * @notice Wraps the native token into its ERC-20 equivalent (e.g., ETH to WETH).
     * @param nativeAmount Amount of the native token to wrap.
     * @return wrappedAmount Amount of the wrapped token received.
     * @dev Reverts with {WrapUnwrapFailed} if the wrap operation fails.
     */
    function _wrapNativeToken(uint256 nativeAmount) internal returns (uint256 wrappedAmount) {
        // Get the balance of the wrapped native token before wrapping
        uint256 wrappedBalanceBefore = WRAPPED_NATIVE_TOKEN.balanceOf(address(this));
        // Wrap the native token
        WRAPPED_NATIVE_TOKEN.deposit{value: nativeAmount}();
        // Get the balance of the wrapped native token after wrapping
        uint256 wrappedBalanceAfter = WRAPPED_NATIVE_TOKEN.balanceOf(address(this));
        // Calculate the amount of wrapped tokens
        wrappedAmount = wrappedBalanceAfter - wrappedBalanceBefore;
        // Revert if the amount of wrapped tokens is not equal to the expected amount
        if (nativeAmount != wrappedAmount) revert WrappingFailed(nativeAmount, wrappedAmount);
    }

    /**
     * @notice Unwraps the wrapped token into the native token (e.g., WETH to ETH).
     * @param wrappedAmount Amount of the wrapped token to unwrap.
     * @dev Reverts with {WrapUnwrapFailed} if the unwrap operation fails.
     */
    function _unwrapNativeToken(uint256 wrappedAmount) internal returns (uint256 nativeAmount) {
        // Get the balance of the native token before unwrapping
        uint256 nativeBalanceBefore = address(this).balance;
        // Unwrap the wrapped native token
        WRAPPED_NATIVE_TOKEN.withdraw(wrappedAmount);
        // Get the balance of the native token after unwrapping
        uint256 nativeBalanceAfter = address(this).balance;
        // Calculate the amount of unwrapped tokens
        nativeAmount = nativeBalanceAfter - nativeBalanceBefore;
        // Revert if the amount of unwrapped tokens is not equal to the expected amount
        if (wrappedAmount != nativeAmount) revert UnwrappingFailed(wrappedAmount, nativeAmount);
    }
}
