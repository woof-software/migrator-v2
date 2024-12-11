// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapModule} from "./SwapModule.sol";
import {IDaiUsds} from "./interfaces/IDaiUsds.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

abstract contract BaseAdapter is SwapModule {
    /// --------Constants-------- ///

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @notice Address of the wrapped native token (e.g., WETH).
     */
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

    /**
     * @notice Converter contract for DAI to USDS.
     */
    IDaiUsds public immutable DAI_USDS_CONVERTER;

    /**
     * @notice Address of the DAI token.
     */
    address public immutable DAI;

    /**
     * @notice Address of the USDS token.
     */
    address public immutable USDS;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the DAI to USDS conversion fails.
     */
    error ConversionFailed(uint256 expectedAmount, uint256 actualAmount);

    error InsufficientAmountForWrapping();

    error WrappingFailed(uint256 expectedAmount, uint256 actualAmount);

    error UnwrappingFailed(uint256 expectedAmount, uint256 actualAmount);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.
     * @param _daiUsdsConverter Address of the DaiUsds converter contract.
     * @param _dai Address of the DAI token.
     * @param _usds Address of the USDS token.
     * @param _wrappedNativeToken Address of the wrapped native token (e.g., WETH).
     */
    constructor(
        address _uniswapRouter,
        address _daiUsdsConverter,
        address _dai,
        address _usds,
        address _wrappedNativeToken
    ) SwapModule(_uniswapRouter) {
        if (
            _daiUsdsConverter == address(0) ||
            _dai == address(0) ||
            _usds == address(0) ||
            _wrappedNativeToken == address(0)
        ) {
            revert InvalidZeroAddress();
        }

        DAI_USDS_CONVERTER = IDaiUsds(_daiUsdsConverter);
        DAI = _dai;
        USDS = _usds;
        WRAPPED_NATIVE_TOKEN = IWETH9(_wrappedNativeToken);
    }

    /// --------Functions-------- ///

    /**
     * @notice Converts DAI to USDS using the DaiUsds converter contract.
     * @param daiAmount Amount of DAI to be converted.
     * @return usdsAmount Amount of USDS received after conversion.
     * @dev Reverts with {ConversionFailed} if the amount of USDS received is not equal to the expected amount.
     */
    function _convertDaiToUsds(uint256 daiAmount) internal returns (uint256 usdsAmount) {
        // Approve the DaiUsds converter to spend DAI
        IERC20(DAI).approve(address(DAI_USDS_CONVERTER), daiAmount);
        // Get the USDS balance before conversion
        uint256 usdsAmountBefore = IERC20(USDS).balanceOf(address(this));
        // Convert DAI to USDS
        DAI_USDS_CONVERTER.daiToUsds(address(this), daiAmount);
        // Get the USDS balance after conversion
        uint256 usdsAmountAfter = IERC20(USDS).balanceOf(address(this));
        // Calculate the amount of USDS received
        usdsAmount = usdsAmountAfter - usdsAmountBefore;
        // Revert if the amount of USDS received is not equal to the expected amount
        if (daiAmount != usdsAmount) revert ConversionFailed(daiAmount, usdsAmount);
    }

    /**
     * @notice Converts USDS to DAI using the DaiUsds converter contract.
     * @param usdsAmount Amount of USDS to be converted.
     * @return daiAmount Amount of DAI received after conversion.
     * @dev Reverts with {ConversionFailed} if the amount of DAI received is not equal to the expected amount.
     */
    function _convertUsdsToDai(uint256 usdsAmount) internal returns (uint256 daiAmount) {
        // Approve the DaiUsds converter to spend USDS
        IERC20(USDS).approve(address(DAI_USDS_CONVERTER), usdsAmount);
        // Get the DAI balance before conversion
        uint256 daiBalanceBefore = IERC20(DAI).balanceOf(address(this));
        // Convert USDS to DAI
        DAI_USDS_CONVERTER.usdsToDai(address(this), usdsAmount);
        // Get the DAI balance after conversion
        uint256 daiBalanceAfter = IERC20(DAI).balanceOf(address(this));
        // Calculate the amount of DAI received
        daiAmount = daiBalanceAfter - daiBalanceBefore;
        // Revert if the amount of DAI received is not equal to the expected amount
        if (usdsAmount != daiAmount) revert ConversionFailed(usdsAmount, daiAmount);
    }

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

    // /// --------Fallback Function-------- ///

    // /**
    //  * @notice Allows the contract to receive the native token.
    //  */
    // receive() external payable {}
}
