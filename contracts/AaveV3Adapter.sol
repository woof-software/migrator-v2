// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IAaveLendingPool} from "./interfaces/IAaveLendingPool.sol";
import {IComet} from "./interfaces/IComet.sol";
import {IDaiUsds} from "./interfaces/IDaiUsds.sol";

contract AaveV3Adapter is IProtocolAdapter {
    /// --------Custom Types-------- ///

    struct AaveV3Position {
        AaveV3Borrow[] borrows;
        AaveV3Collateral[] collateral;
    }

    struct AaveV3Borrow {
        address token;
        uint256 amount;
        uint256 rateMode; // 1 = stable, 2 = variable
    }

    struct AaveV3Collateral {
        address token;
        uint256 amount;
        address comet;
    }

    /// --------Constants-------- ///

    /**
     * @notice Aave V3 Lending Pool contract address.
     */
    IAaveLendingPool public immutable LENDING_POOL;

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

    error AaveV3Error(uint256 loc, uint256 code);

    /**
     * @dev Reverts if the DAI to USDS conversion fails.
     */
    error ConversionFailed(uint256 expectedAmount, uint256 actualAmount);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the adapter with Aave and DaiUsds contract addresses.
     * @param _aaveLendingPool Address of the Aave V3 Lending Pool contract.
     * @param _daiUsdsConverter Address of the DaiUsds converter contract.
     * @param _dai Address of the DAI token.
     * @param _usds Address of the USDS token.
     */
    constructor(address _aaveLendingPool, address _daiUsdsConverter, address _dai, address _usds) {
        LENDING_POOL = IAaveLendingPool(_aaveLendingPool);
        DAI_USDS_CONVERTER = IDaiUsds(_daiUsdsConverter);
        DAI = _dai;
        USDS = _usds;
    }

    /// --------Functions-------- ///

    function executeMigration(address user, bytes calldata migrationData) external override {
        AaveV3Position memory position = abi.decode(migrationData, (AaveV3Position));

        for (uint256 i = 0; i < position.borrows.length; i++) {
            repayBorrow(user, position.borrows[i]);
        }

        for (uint256 i = 0; i < position.collateral.length; i++) {
            migrateCollateral(user, position.collateral[i]);
        }
    }

    function repayBorrow(address user, AaveV3Borrow memory borrow) internal {
        uint256 repayAmount = borrow.amount;

        IERC20(borrow.token).approve(address(LENDING_POOL), repayAmount);

        uint256 err = LENDING_POOL.repay(borrow.token, repayAmount, borrow.rateMode, user);
        if (err != 0) revert AaveV3Error(0, err);
    }

    function migrateCollateral(address user, AaveV3Collateral memory collateral) internal {
        uint256 collateralAmount = collateral.amount;

        LENDING_POOL.withdraw(collateral.token, collateralAmount, address(this));

        if (collateral.token == DAI) {
            uint256 convertedAmount = _convertDaiToUsds(collateralAmount);
            IERC20(USDS).approve(collateral.comet, convertedAmount);
            IComet(collateral.comet).supplyTo(user, USDS, convertedAmount);
        } else {
            IERC20(collateral.token).approve(collateral.comet, collateralAmount);
            IComet(collateral.comet).supplyTo(user, collateral.token, collateralAmount);
        }
    }

    /**
     * @notice Converts DAI to USDS using the DaiUsds converter contract.
     * @param daiAmount Amount of DAI to be converted.
     * @return usdsAmount Amount of USDS received after conversion.
     * @dev Reverts with {ConversionFailed} if the amount of USDS received is not equal to the expected amount.
     */
    function _convertDaiToUsds(uint256 daiAmount) internal returns (uint256 usdsAmount) {
        IERC20(DAI).approve(address(DAI_USDS_CONVERTER), daiAmount);

        DAI_USDS_CONVERTER.daiToUsds(address(this), daiAmount);

        usdsAmount = IERC20(USDS).balanceOf(address(this));

        if (daiAmount != usdsAmount) revert ConversionFailed(daiAmount, usdsAmount);
    }
}
