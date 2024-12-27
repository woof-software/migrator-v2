// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDaiUsds} from "../interfaces/IDaiUsds.sol";
import {CommonErrors} from "../errors/CommonErrors.sol";

/**
 * @title SwapModule
 * @notice Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.
 * @dev Designed as an abstract contract for adapters to inherit.
 */
abstract contract ConvertModule is CommonErrors {
    /// --------Constants-------- ///

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

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.
     * @param _daiUsdsConverter Address of the DaiUsds converter contract.
     * @param _dai Address of the DAI token.
     * @param _usds Address of the USDS token.
     */
    constructor(address _daiUsdsConverter, address _dai, address _usds) {
        if (_daiUsdsConverter == address(0) || _dai == address(0) || _usds == address(0)) {
            revert InvalidZeroAddress();
        }

        DAI_USDS_CONVERTER = IDaiUsds(_daiUsdsConverter);
        DAI = _dai;
        USDS = _usds;
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
}
