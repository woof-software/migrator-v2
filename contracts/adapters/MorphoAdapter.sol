// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {WrapModule} from "../modules/WrapModule.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "../interfaces/morpho/IMorpho.sol";
import {SharesMathLib} from "../libs/morpho/SharesMathLib.sol";

/// @title MorphoAdapter
/// @notice Adapter contract to migrate positions from Morpho to Compound III (Comet)
contract MorphoAdapter is IProtocolAdapter, SwapModule, WrapModule, ConvertModule {
    using SharesMathLib for uint256;

    /// --------Custom Types-------- ///

    struct DeploymentParams {
        address uniswapRouter;
        address daiUsdsConverter;
        address dai;
        address usds;
        address wrappedNativeToken;
        address morphoLendingPool;
        bool isFullMigration;
    }

    /**
     * @notice Structure representing the user's position in Morpho
     * @dev borrows Array of borrow positions to repay
     * @dev collateral Array of collateral positions to migrate
     */
    struct MorphoPosition {
        MorphoBorrow[] borrows;
        MorphoCollateral[] collateral;
    }

    /**
     * @notice Structure representing an individual borrow position in Morpho
     * @dev loanToken Address of the Morpho variable debt token
     * @dev assetsAmount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct MorphoBorrow {
        Id marketId;
        // address loanToken;
        uint256 assetsAmount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Structure representing an individual collateral position in Morpho
     * @dev collateralToken Address of the Morpho spToken (collateral token)
     * @dev assetsAmount Amount of collateral to migrate; use `type(uint256).max` to migrate all
     */
    struct MorphoCollateral {
        Id marketId;
        // address collateralToken;
        uint256 assetsAmount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;

    /**
     * @notice Morpho Lending Pool contract address
     */
    IMorpho public immutable LENDING_POOL;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the debt for a specific token has not been successfully cleared
     */
    error DebtNotCleared(address spToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the MorphoAdapter contract
     * @param deploymentParams Deployment parameters for the MorphoAdapter contract:
     * - uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * - daiUsdsConverter Address of the DAI to USDS converter contract
     * - dai Address of the DAI token
     * - usds Address of the USDS token
     * - wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * - sparkLendingPool Address of the Morpho Lending Pool contract
     * - sparkDataProvider Address of the Morpho Data Provider contract
     * - isFullMigration Boolean indicating whether the migration is full or partial
     * @dev Reverts if any of the provided addresses are zero
     */
    constructor(
        DeploymentParams memory deploymentParams
    )
        SwapModule(deploymentParams.uniswapRouter)
        ConvertModule(deploymentParams.daiUsdsConverter, deploymentParams.dai, deploymentParams.usds)
        WrapModule(deploymentParams.wrappedNativeToken)
    {
        if (deploymentParams.morphoLendingPool == address(0)) revert InvalidZeroAddress();
        LENDING_POOL = IMorpho(deploymentParams.morphoLendingPool);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's Morpho position to Compound III
     * @dev This function decodes the migration data and processes borrows and collateral
     * @param user Address of the user whose position is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param migrationData Encoded data containing the user's Morpho position details
     */
    function executeMigration(address user, address comet, bytes calldata migrationData) external override {
        // Decode the migration data into an SparkPosition struct
        MorphoPosition memory position = abi.decode(migrationData, (MorphoPosition));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            repayBorrow(user, position.borrows[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collateral.length; i++) {
            migrateCollateral(user, comet, position.collateral[i]);
        }
    }

    /**
     * @notice Repays a borrow position for the user on Morpho
     * @dev May perform a swap to obtain the necessary tokens for repayment
     * @param user Address of the user whose borrow is being repaid
     * @param borrow The borrow position details
     */
    function repayBorrow(address user, MorphoBorrow memory borrow) internal {
        Market memory market = LENDING_POOL.market(borrow.marketId);
        MarketParams memory marketParams = LENDING_POOL.idToMarketParams(borrow.marketId);
        Position memory position = LENDING_POOL.position(borrow.marketId, user);

        // Determine the amount to repay. If max value, repay the full borrow balance
        if (borrow.assetsAmount == type(uint256).max) {
            uint256 totalAssets = uint256(position.borrowShares).toAssetsUp(
                market.totalBorrowAssets,
                market.totalSupplyShares
            );
            borrow.assetsAmount = totalAssets;
        }

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(borrow.swapParams.path);
            address tokenOut = _decodeTokenOut(borrow.swapParams.path);
            // If the swap is from USDS to DAI, convert USDS to DAI
            if (tokenIn == ConvertModule.USDS && tokenOut == ConvertModule.DAI) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(borrow.assetsAmount);
            } else {
                // Perform a swap to obtain the borrow token using the provided swap parameters
                _swapFlashloanToBorrowToken(
                    ISwapRouter.ExactOutputParams({
                        path: borrow.swapParams.path,
                        recipient: address(this),
                        amountOut: borrow.assetsAmount,
                        amountInMaximum: borrow.swapParams.amountInMaximum,
                        deadline: block.timestamp
                    })
                );
            }
        }

        // Get the underlying asset address of the debt token
        address loanAsset = marketParams.loanToken;
        uint256 repayAssets = borrow.assetsAmount;

        // Approve the Morpho Lending Pool to spend the repayment amount
        IERC20(loanAsset).approve(address(LENDING_POOL), repayAssets);

        uint256 repayShares = repayAssets.toSharesDown(market.totalBorrowAssets, market.totalSupplyShares);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(marketParams, 0, repayShares, user, "");

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(borrow.marketId, user)) revert DebtNotCleared(marketParams.loanToken);
    }

    /**
     * @notice Migrates a user's collateral position from Morpho to Compound III
     * @dev May perform a swap to obtain the migration tokens
     * @param user Address of the user whose collateral is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param collateral The collateral position details
     */
    function migrateCollateral(address user, address comet, MorphoCollateral memory collateral) internal {
        MarketParams memory marketParams = LENDING_POOL.idToMarketParams(collateral.marketId);
        Position memory position = LENDING_POOL.position(collateral.marketId, user);

        // // Determine the amount of collateral to migrate. If max value, migrate the full collateral balance
        uint256 withdrawAmount = collateral.assetsAmount == type(uint256).max
            ? position.collateral
            : collateral.assetsAmount;

        // Get the underlying asset address of the collateral token
        address collateralAsset = marketParams.collateralToken;

        // Withdraw the collateral from Morpho
        LENDING_POOL.withdrawCollateral(marketParams, withdrawAmount, user, address(this));
        
        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(collateral.swapParams.path);
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(withdrawAmount);
                IERC20(ConvertModule.USDS).approve(comet, withdrawAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, withdrawAmount);
                return;
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: collateral.swapParams.path,
                        recipient: address(this),
                        amountIn: withdrawAmount,
                        amountOutMinimum: collateral.swapParams.amountOutMinimum,
                        deadline: block.timestamp
                    })
                );
                IERC20(tokenOut).approve(comet, amountOut);
                IComet(comet).supplyTo(user, tokenOut, amountOut);
                return;
            }
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (collateralAsset == WrapModule.NATIVE_TOKEN) {
            uint256 wrappedAmount = _wrapNativeToken(withdrawAmount);
            WrapModule.WRAPPED_NATIVE_TOKEN.approve(comet, wrappedAmount);
            IComet(comet).supplyTo(user, address(WrapModule.WRAPPED_NATIVE_TOKEN), wrappedAmount);
            return;
            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(collateralAsset).approve(comet, withdrawAmount);
            IComet(comet).supplyTo(user, collateralAsset, withdrawAmount);
        }
    }

    /**
     * @notice Checks if the debt for a specific token has been successfully closed.
     * @param id Address of the market.
     * @param user Address of the user.
     * @return isCleared Boolean indicating whether the debt is cleared.
     */
    function _isDebtCleared(Id id, address user) internal view returns (bool isCleared) {
        // Get the user's current debt balance for the specified asset
        Position memory position = LENDING_POOL.position(id, user);
        // Debt is cleared if the total debt balance is zero
        return position.borrowShares == 0;
    }
}
