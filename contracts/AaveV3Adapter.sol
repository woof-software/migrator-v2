// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAdapter} from "./BaseAdapter.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IAaveLendingPool} from "./interfaces/IAaveLendingPool.sol";
import {IComet} from "./interfaces/IComet.sol";

contract AaveV3Adapter is BaseAdapter, IProtocolAdapter {
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

    /// --------Errors-------- ///

    error AaveV3Error(uint256 loc, uint256 code);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the adapter with Aave and DaiUsds contract addresses.
     * @param _aaveLendingPool Address of the Aave V3 Lending Pool contract.
     * @param _daiUsdsConverter Address of the DaiUsds converter contract.
     * @param _dai Address of the DAI token.
     * @param _usds Address of the USDS token.
     */
    constructor(
        address _uniswapRouter,
        address _daiUsdsConverter,
        address _dai,
        address _usds,
        address _wrappedNativeToken,
        address _aaveLendingPool
    ) BaseAdapter(_uniswapRouter, _daiUsdsConverter, _dai, _usds, _wrappedNativeToken) {
        if (_aaveLendingPool == address(0)) revert InvalidZeroAddress();
        LENDING_POOL = IAaveLendingPool(_aaveLendingPool);
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
}
