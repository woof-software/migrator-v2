// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAdapter} from "./BaseAdapter.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IAaveLendingPool} from "./interfaces/IAaveLendingPool.sol";
import {IComet} from "./interfaces/IComet.sol";
import {ISwapRouter} from "./interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {IADebtToken} from "./interfaces/aave/IADebtToken.sol";
import {IAToken} from "./interfaces/aave/IAToken.sol";

/// @title AaveV3Adapter
/// @notice Adapter contract to migrate positions from Aave V3 to Compound III (Comet)
contract AaveV3Adapter is BaseAdapter, IProtocolAdapter {
    /// --------Custom Types-------- ///

    /**
     * @notice Structure representing the user's position in Aave V3
     * @dev borrows Array of borrow positions to repay
     * @dev collateral Array of collateral positions to migrate
     * @dev swaps Array of swap parameters corresponding to each borrow
     */
    struct AaveV3Position {
        AaveV3Borrow[] borrows;
        AaveV3Collateral[] collateral;
        Swap[] swaps;
    }

    /**
     * @notice Structure representing an individual borrow position in Aave V3
     * @dev aDebtToken Address of the Aave V3 variable debt token
     * @dev amount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct AaveV3Borrow {
        address aDebtToken;
        uint256 amount;
    }

    /**
     * @notice Structure representing an individual collateral position in Aave V3
     * @dev aToken Address of the Aave V3 aToken (collateral token)
     * @dev amount Amount of collateral to migrate; use `type(uint256).max` to migrate all
     */
    struct AaveV3Collateral {
        address aToken;
        uint256 amount;
    }

    /// --------Constants-------- ///

    /// @notice Interest rate mode for variable-rate borrowings in Aave V3 (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

    /**
     * @notice Aave V3 Lending Pool contract address
     */
    IAaveLendingPool public immutable LENDING_POOL;

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the AaveV3Adapter contract
     * @param _uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param _daiUsdsConverter Address of the DAI to USDS converter contract
     * @param _dai Address of the DAI token
     * @param _usds Address of the USDS token
     * @param _wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * @param _aaveLendingPool Address of the Aave V3 Lending Pool contract
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

    /**
     * @notice Executes the migration of a user's Aave V3 position to Compound III
     * @dev This function decodes the migration data and processes borrows and collateral
     * @param user Address of the user whose position is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param migrationData Encoded data containing the user's Aave V3 position details
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData
    ) external override {
        // Decode the migration data into an AaveV3Position struct
        AaveV3Position memory position = abi.decode(migrationData, (AaveV3Position));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            repayBorrow(user, position.borrows[i], position.swaps[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collateral.length; i++) {
            migrateCollateral(user, comet, position.collateral[i]);
        }
    }

    /**
     * @notice Repays a borrow position for the user on Aave V3
     * @dev May perform a swap to obtain the necessary tokens for repayment
     * @param user Address of the user whose borrow is being repaid
     * @param borrow The borrow position details
     * @param swap Swap parameters to obtain the repayment tokens, if needed
     */
    function repayBorrow(address user, AaveV3Borrow memory borrow, Swap memory swap) internal {
        uint256 repayAmount = borrow.amount;

        // Determine the amount to repay; if max value, repay the full debt balance
        if (borrow.amount == type(uint256).max) {
            repayAmount = IERC20(borrow.aDebtToken).balanceOf(user);
        }

        // If a swap is required to obtain the repayment tokens
        if (swap.path.length > 0) {
            address tokenIn = _decodeTokenIn(swap.path);
            address tokenOut = _decodeTokenOut(swap.path);
            // If the swap is from USDS to DAI, convert USDS to DAI
            if (tokenIn == BaseAdapter.USDS && tokenOut == BaseAdapter.DAI) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(repayAmount);
            } else {
                // Perform a swap to obtain the borrow token using the provided swap parameters
                _swapFlashloanToBorrowToken(
                    ISwapRouter.ExactOutputParams({
                        path: swap.path,
                        recipient: address(this),
                        amountOut: repayAmount,
                        amountInMaximum: swap.amountInMaximum,
                        deadline: block.timestamp
                    })
                );
            }
        }

        // Get the underlying asset address of the debt token
        address underlyingAsset = IADebtToken(borrow.aDebtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Aave Lending Pool to spend the repayment amount
        IADebtToken(underlyingAsset).approve(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);
    }

    function migrateCollateral(
        address user,
        address comet,
        AaveV3Collateral memory collateral
    ) internal {
        uint256 collateralAmount = collateral.amount;

        LENDING_POOL.withdraw(collateral.aToken, collateralAmount, address(this));

        if (collateral.aToken == DAI) {
            uint256 convertedAmount = _convertDaiToUsds(collateralAmount);

            IERC20(USDS).approve(comet, convertedAmount);

            IComet(comet).supplyTo(user, USDS, convertedAmount);
        } else {
            IERC20(collateral.aToken).approve(comet, collateralAmount);
            IComet(comet).supplyTo(user, collateral.aToken, collateralAmount);
        }
    }
}
