// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDaiUsds} from "../interfaces/IDaiUsds.sol";
import {CommonErrors} from "../errors/CommonErrors.sol";

/**
 * @title ConvertModule
 * @notice Provides functionality for converting between DAI and USDS using a DaiUsds converter contract.
 * @dev This abstract contract is designed to be inherited by other contracts that require stablecoin conversion.
 *      It ensures efficient and safe conversions by validating inputs and handling errors.
 */
abstract contract ConvertModule is CommonErrors {
    /// -------- Libraries -------- ///
    using SafeERC20 for IERC20;

    /// --------Constants-------- ///

    /**
     * @notice The DaiUsds converter contract used for converting between DAI and USDS.
     *
     * @dev This contract facilitates the conversion of DAI to USDS and vice versa. It is initialized
     *      during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety.
     */
    IDaiUsds public immutable DAI_USDS_CONVERTER;

    /**
     * @notice Address of the DAI token.
     *
     * @dev This variable holds the address of the DAI token used for conversions in the `ConvertModule`.
     *      It is initialized during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety.
     */ IERC20 public immutable DAI;

    /**
     * @notice Address of the USDS token.
     *
     * @dev This variable holds the address of the USDS token used for conversions in the `ConvertModule`.
     *      It is initialized during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety.
     */ IERC20 public immutable USDS;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the DAI to USDS or USDS to DAI conversion fails.
     * @param expectedAmount The expected amount of tokens to be received after conversion.
     * @param actualAmount The actual amount of tokens received after conversion.
     *
     * @notice This error is triggered when the amount of tokens received from the Dai ⇄ USDS conversion
     *         does not match the expected amount, indicating a failure in the conversion process.
     */
    error ConversionFailed(uint256 expectedAmount, uint256 actualAmount);

    /**
     * @dev Reverts if the provided token addresses are identical.
     * @param token Address of the token that caused the error.
     *
     * @notice This error is triggered when the DAI and USDS token addresses are the same,
     *         which is invalid for the Dai ⇄ USDS conversion process.
     */
    error IdenticalTokenAddresses(address token);

    /**
     * @dev Reverts if the configuration of the DaiUsds converter, DAI token, or USDS token is inconsistent.
     *
     * @param converter The address of the DaiUsds converter contract.
     * @param dai The address of the DAI token.
     * @param usds The address of the USDS token.
     *
     * @notice This error is triggered when the provided DaiUsds converter, DAI, and USDS addresses
     *         do not match the expected configuration. This ensures that the converter and token
     *         addresses are consistent and valid for the conversion process.
     */
    error ConverterConfigMismatch(address converter, address dai, address usds);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the ConvertModule with the DaiUsds converter, DAI token, and USDS token addresses.
     *
     * @param _daiUsdsConverter The address of the DaiUsds converter contract.
     * @param _dai The address of the DAI token.
     * @param _usds The address of the USDS token.
     *
     * @dev This constructor sets up the DaiUsds converter and token addresses. It validates the provided addresses
     *      to ensure they are consistent and non-zero when a converter is specified. If no converter is provided
     *      (`_daiUsdsConverter` is zero), the DAI and USDS addresses are set to zero as well.
     *
     * Requirements:
     * - If `_daiUsdsConverter` is non-zero:
     *   - `_dai` and `_usds` must not be zero addresses.
     *   - `_dai` and `_usds` must not be identical.
     *
     * Reverts:
     * - {ConverterConfigMismatch} if the provided DaiUsds converter, DAI, and USDS addresses are inconsistent.
     * - {IdenticalTokenAddresses} if `_dai` and `_usds` are the same address.
     */
    constructor(address _daiUsdsConverter, address _dai, address _usds) {
        bool isConsistent = (_daiUsdsConverter == address(0) && _dai == address(0) && _usds == address(0)) ||
            (_daiUsdsConverter != address(0) && _dai != address(0) && _usds != address(0));

        if (!isConsistent) {
            revert ConverterConfigMismatch(_daiUsdsConverter, _dai, _usds);
        }

        if (_daiUsdsConverter != address(0) && _dai == _usds) {
            revert IdenticalTokenAddresses(_dai);
        }

        DAI_USDS_CONVERTER = IDaiUsds(_daiUsdsConverter);
        DAI = IERC20(_dai);
        USDS = IERC20(_usds);
    }

    /// --------Functions-------- ///

    /**
     * @notice Converts DAI to USDS using the DaiUsds converter contract.
     *
     * @param daiAmount The amount of DAI to be converted.
     * @return usdsAmount The amount of USDS received after conversion.
     *
     * @dev This function performs the following steps:
     *      1. Approves the DaiUsds converter contract to spend the specified `daiAmount`.
     *      2. Retrieves the current USDS balance of the contract before the conversion.
     *      3. Calls the `daiToUsds` function on the DaiUsds converter contract to perform the conversion.
     *      4. Retrieves the USDS balance of the contract after the conversion.
     *      5. Calculates the amount of USDS received by subtracting the pre-conversion balance from the post-conversion balance.
     *      6. Reverts with {ConversionFailed} if the amount of USDS received does not match the expected amount (`daiAmount`).
     *
     * Requirements:
     * - The DaiUsds converter contract must be properly configured and operational.
     * - The contract must have sufficient DAI balance to perform the conversion.
     *
     * Reverts:
     * - {ConversionFailed} if the amount of USDS received is not equal to the expected amount.
     */
    function _convertDaiToUsds(uint256 daiAmount) internal returns (uint256 usdsAmount) {
        // Approve the DaiUsds converter to spend DAI
        DAI.forceApprove(address(DAI_USDS_CONVERTER), daiAmount);
        // Get the USDS balance before conversion
        uint256 usdsAmountBefore = USDS.balanceOf(address(this));
        // Convert DAI to USDS
        DAI_USDS_CONVERTER.daiToUsds(address(this), daiAmount);
        // Get the USDS balance after conversion
        uint256 usdsAmountAfter = USDS.balanceOf(address(this));
        // Calculate the amount of USDS received
        usdsAmount = usdsAmountAfter - usdsAmountBefore;
        // Revert if the amount of USDS received is not equal to the expected amount
        if (daiAmount != usdsAmount) revert ConversionFailed(daiAmount, usdsAmount);
    }

    /**
     * @notice Converts USDS to DAI using the DaiUsds converter contract.
     *
     * @param usdsAmount The amount of USDS to be converted.
     * @return daiAmount The amount of DAI received after conversion.
     *
     * @dev This function performs the following steps:
     *      1. Approves the DaiUsds converter contract to spend the specified `usdsAmount`.
     *      2. Retrieves the current DAI balance of the contract before the conversion.
     *      3. Calls the `usdsToDai` function on the DaiUsds converter contract to perform the conversion.
     *      4. Retrieves the DAI balance of the contract after the conversion.
     *      5. Calculates the amount of DAI received by subtracting the pre-conversion balance from the post-conversion balance.
     *      6. Reverts with {ConversionFailed} if the amount of DAI received does not match the expected amount (`usdsAmount`).
     *
     * Requirements:
     * - The DaiUsds converter contract must be properly configured and operational.
     * - The contract must have sufficient USDS balance to perform the conversion.
     *
     * Reverts:
     * - {ConversionFailed} if the amount of DAI received is not equal to the expected amount.
     */
    function _convertUsdsToDai(uint256 usdsAmount) internal returns (uint256 daiAmount) {
        // Approve the DaiUsds converter to spend USDS
        USDS.forceApprove(address(DAI_USDS_CONVERTER), usdsAmount);
        // Get the DAI balance before conversion
        uint256 daiBalanceBefore = DAI.balanceOf(address(this));
        // Convert USDS to DAI
        DAI_USDS_CONVERTER.usdsToDai(address(this), usdsAmount);
        // Get the DAI balance after conversion
        uint256 daiBalanceAfter = DAI.balanceOf(address(this));
        // Calculate the amount of DAI received
        daiAmount = daiBalanceAfter - daiBalanceBefore;
        // Revert if the amount of DAI received is not equal to the expected amount
        if (usdsAmount != daiAmount) revert ConversionFailed(usdsAmount, daiAmount);
    }
}
