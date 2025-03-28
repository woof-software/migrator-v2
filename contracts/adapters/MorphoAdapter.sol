// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "../interfaces/morpho/IMorpho.sol";
import {SharesMathLib} from "../libs/morpho/SharesMathLib.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {DelegateReentrancyGuard} from "../utils/DelegateReentrancyGuard.sol";

/**
 * @title MorphoAdapter
 * @notice Adapter contract for migrating user positions from Morpho Protocol to Compound III (Comet).
 *
 * @dev This adapter implements `IProtocolAdapter` and is designed to be called via `delegatecall` from the main migrator contract (e.g. `MigratorV2`).
 * It facilitates the seamless migration of borrow and collateral positions from Morpho to Compound III markets. The adapter extends `SwapModule`
 * for Uniswap V3 swap support and uses `DelegateReentrancyGuard` to protect against reentrancy when executed via delegatecall.
 *
 * Core responsibilities include:
 * - Repayment of Morpho borrow positions using either:
 *    - Tokens held by the contract,
 *    - Tokens swapped via Uniswap V3 (`_swapFlashloanToBorrowToken`), or
 *    - Assets withdrawn from Compound III in case of flash loan repayment.
 * - Withdrawal of user collateral from Morpho using `withdrawCollateral` followed by:
 *    - Direct supply to Compound III,
 *    - Token conversion via Uniswap V3 if necessary, or
 *    - Native token wrapping (e.g. ETH → WETH) if required by the Comet market.
 * - Handling optional flash loan repayments from Uniswap V3 pools, optionally drawing funds from the user's Comet balance.
 * - Full or partial migrations, governed by the `IS_FULL_MIGRATION` flag. If set to `true`, the adapter enforces full debt repayment and reverts if residual borrow shares remain.
 *
 * Key features:
 * - Flexible repayment via Uniswap swaps with slippage control.
 * - Dynamic debt resolution using real-time share-to-asset conversions.
 * - Native token support (via WETH wrapping).
 * - Fully modular design via inheritance of common migration logic from `SwapModule`.
 *
 * Requirements:
 * - The user must grant this contract necessary allowances and have an active position in the specified Morpho markets.
 * - The migration configuration must include valid Uniswap paths when swaps are required.
 * - The adapter must be called within a delegate context (e.g., from a proxy/migrator).
 *
 * Limitations:
 * - Only variable borrow positions are supported (via `borrowShares`).
 * - Does not include any DAI ⇄ USDS conversion logic (unlike `*UsdsAdapter` variants).
 */
contract MorphoAdapter is IProtocolAdapter, SwapModule, DelegateReentrancyGuard {
    /// -------- Libraries -------- ///

    using SharesMathLib for uint256;
    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    struct DeploymentParams {
        address uniswapRouter;
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
        uint256 assetsAmount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @notice Address of the wrapped native token (e.g., WETH).
     */
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

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
    constructor(DeploymentParams memory deploymentParams) SwapModule(deploymentParams.uniswapRouter) {
        if (deploymentParams.morphoLendingPool == address(0) || deploymentParams.wrappedNativeToken == address(0))
            revert InvalidZeroAddress();

        LENDING_POOL = IMorpho(deploymentParams.morphoLendingPool);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
        WRAPPED_NATIVE_TOKEN = IWETH9(deploymentParams.wrappedNativeToken);
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's full or partial position from Morpho to Compound III (Comet).
     *
     * @dev This function orchestrates the full migration flow from Morpho to Compound III by:
     *  1. Decoding the ABI-encoded `MorphoPosition` structure that contains:
     *     - An array of `MorphoBorrow` items, each representing a borrow position to repay.
     *     - An array of `MorphoCollateral` items, each representing a collateral position to migrate.
     *  2. For each borrow:
     *     - Loads the market parameters using `idToMarketParams()` from Morpho.
     *     - Accrues interest to ensure up-to-date borrow data.
     *     - Optionally performs a token swap to obtain repayment assets.
     *     - Repays the borrow using `repay()`.
     *  3. For each collateral:
     *     - Retrieves the user's collateral position from Morpho.
     *     - Withdraws the collateral using `withdrawCollateral()`.
     *     - Optionally performs a swap to convert the token into a target-compatible asset.
     *     - Supplies the final asset to the target Compound III market using `supplyTo()`.
     *  4. If a flash loan was used (i.e. `flashloanData` is non-empty), repays it via `_repayFlashloan`.
     *
     * This function supports full and partial migrations. If `IS_FULL_MIGRATION` is true, it performs
     * debt clearance verification after repayment and reverts if any borrow remains.
     *
     * @param user The address of the user whose position is being migrated from Morpho.
     * @param comet The address of the target Compound III (Comet) market receiving the migrated assets.
     * @param migrationData ABI-encoded `MorphoPosition` struct specifying borrow and collateral migration details.
     * @param flashloanData Optional ABI-encoded data used to repay a Uniswap V3 flash loan, if one was utilized.
     *
     * Requirements:
     * - The user must have an active position in Morpho.
     * - Approvals must be in place for this contract to pull required tokens from the user.
     * - If swaps are involved, the swap paths and parameters must be valid.
     *
     * Effects:
     * - Fully repays user’s debts and migrates collateral from Morpho to Compound III.
     * - Optionally swaps tokens to align with target market requirements.
     * - Optionally repays flash loan used for atomic migration.
     *
     * Reverts:
     * - If full migration is enabled and debt remains uncleared after repayment.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData
    ) external override nonReentrant {
        // Decode the migration data into an SparkPosition struct
        MorphoPosition memory position = abi.decode(migrationData, (MorphoPosition));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            _repayBorrow(user, position.borrows[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collateral.length; i++) {
            _migrateCollateral(user, comet, position.collateral[i]);
        }

        // Repay flashloan
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData);
        }
    }

    /**
     * @notice Repays a flash loan obtained during the Morpho-to-Compound III migration process.
     *
     * @dev This function ensures that the total borrowed flash loan amount, including the associated fee,
     * is fully repaid to the Uniswap V3 liquidity pool that issued it. The repayment strategy includes:
     *
     * - First checking whether the current contract holds enough balance in `flashBaseToken`.
     * - If not, withdrawing the shortfall from the user's Compound III account via `withdrawFrom()`.
     * - Finally, transferring the full `flashAmountWithFee` back to the liquidity pool using `safeTransfer()`.
     *
     * This logic assumes that the token used for the flash loan (`flashBaseToken`) is compatible with both
     * the Uniswap V3 pool and the Comet market, and does not require any token conversion logic.
     *
     * @param user The address of the user whose Compound III (Comet) balance may be used to cover the shortfall.
     * @param comet The address of the Compound III market from which funds may be withdrawn on behalf of the user.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): Uniswap V3 pool that provided the flash loan.
     *        - `flashBaseToken` (address): The ERC-20 token borrowed.
     *        - `flashAmountWithFee` (uint256): Total repayment amount, including the loan fee.
     *
     * Requirements:
     * - The contract must be able to fully repay the flash loan in `flashBaseToken`.
     * - If the contract's internal balance is insufficient, the user must have sufficient balance
     *   in Comet for the withdrawal to succeed.
     *
     * Effects:
     * - May trigger `withdrawFrom()` to pull tokens from the user's Comet account.
     * - Completes repayment by transferring funds to the flash loan provider.
     *
     * Reverts:
     * - If the flash loan cannot be repaid in full due to insufficient funds or withdrawal failure.
     */
    function _repayFlashloan(address user, address comet, bytes calldata flashloanData) internal {
        (address flashLiquidityPool, address flashBaseToken, uint256 flashAmountWithFee) = abi.decode(
            flashloanData,
            (address, address, uint256)
        );

        address executor = address(this);
        uint256 balance = IERC20(flashBaseToken).balanceOf(executor);

        if (balance < flashAmountWithFee) {
            // Withdraw the required amount from the user's Comet account
            IComet(comet).withdrawFrom(user, executor, flashBaseToken, (flashAmountWithFee - balance));
        }

        // Repay the flash loan
        IERC20(flashBaseToken).safeTransfer(flashLiquidityPool, flashAmountWithFee);
    }

    /**
     * @notice Repays a borrow position for the user in the Morpho protocol.
     *
     * @dev This function performs the following operations:
     *  1. Retrieves the `MarketParams` for the specified `marketId` and accrues interest via `accrueInterest()`.
     *  2. Loads the user's position to access the current borrow shares.
     *  3. If `assetsAmount` equals `type(uint256).max`, calculates the full debt by converting borrow shares to assets.
     *  4. If a token swap is required (`swapParams.path.length > 0`), executes a Uniswap V3 exact output swap
     *     to acquire the debt repayment token.
     *  5. Approves the Morpho Lending Pool to pull `loanToken` for repayment.
     *  6. Executes the repayment using the exact borrow shares from the user's position.
     *  7. If `IS_FULL_MIGRATION` is true, validates that the user’s debt position is fully cleared after repayment.
     *
     * @param user The address of the user whose borrow position is being repaid.
     * @param borrow Struct representing the borrow position to be repaid:
     *        - `marketId`: Identifier of the Morpho market.
     *        - `assetsAmount`: Amount of debt to repay (or `type(uint256).max` to repay all).
     *        - `swapParams`: Optional parameters for acquiring the repayment token via Uniswap V3.
     *
     * Requirements:
     * - The user must have an existing borrow position in the specified market.
     * - If swapping is required, the path must be valid and the contract must hold or acquire enough input tokens.
     * - On full migration, residual borrow shares must be zero after repayment.
     *
     * Effects:
     * - Accrues interest for the target market.
     * - Performs an on-chain swap if repayment tokens need to be acquired.
     * - Transfers and repays the debt on behalf of the user.
     * - Reverts with `DebtNotCleared` if debt remains and `IS_FULL_MIGRATION` is enabled.
     */
    function _repayBorrow(address user, MorphoBorrow memory borrow) internal {
        MarketParams memory marketParams = LENDING_POOL.idToMarketParams(borrow.marketId);

        LENDING_POOL.accrueInterest(marketParams); // call

        Position memory position = LENDING_POOL.position(borrow.marketId, user);

        // Determine the amount to repay. If max value, repay the full borrow balance
        if (borrow.assetsAmount == type(uint256).max) {
            Market memory market = LENDING_POOL.market(borrow.marketId);
            borrow.assetsAmount = uint256(position.borrowShares).toAssetsUp(
                market.totalBorrowAssets,
                market.totalBorrowShares
            );
        }

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
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

        IERC20(marketParams.loanToken).safeIncreaseAllowance(address(LENDING_POOL), borrow.assetsAmount);

        LENDING_POOL.repay(marketParams, 0, position.borrowShares, user, new bytes(0));

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(borrow.marketId, user)) revert DebtNotCleared(marketParams.loanToken);
    }

    /**
     * @notice Migrates a user's collateral position from Morpho to Compound III (Comet).
     *
     * @dev This function performs the following steps:
     *  1. Retrieves the `MarketParams` for the specified `marketId` and loads the user's current position.
     *  2. Determines the amount of collateral to migrate. If `assetsAmount == type(uint256).max`, it uses the full collateral balance.
     *  3. Calls `withdrawCollateral()` on the Morpho Lending Pool to transfer the collateral to this contract.
     *  4. Depending on `swapParams`, it performs one of the following:
     *     - Executes a Uniswap V3 swap to convert the collateral to the desired token (`tokenOut`),
     *       then supplies the swapped token to the `comet` contract.
     *     - If the collateral asset is a native token (e.g., ETH), wraps it into WETH and supplies it.
     *     - Otherwise, supplies the original collateral token directly to the Comet market.
     *
     * @param user The address of the user whose collateral is being migrated.
     * @param comet The address of the Compound III (Comet) market that will receive the collateral.
     * @param collateral Struct representing the collateral to migrate:
     *        - `marketId`: The ID of the Morpho market where the collateral is held.
     *        - `assetsAmount`: The amount of collateral to migrate (use `type(uint256).max` to migrate all).
     *        - `swapParams`: Optional Uniswap V3 swap parameters used to convert the token before supplying.
     *
     * Requirements:
     * - The user must have sufficient collateral in the specified market.
     * - If a swap is required, `swapParams.path` must be valid and executable.
     * - If the asset is native (e.g., ETH), the contract must support wrapping into an ERC-20 (e.g., WETH).
     *
     * Effects:
     * - Withdraws collateral from Morpho.
     * - Performs optional token swap or wrapping.
     * - Supplies the resulting token into the target Comet market on behalf of the user.
     */
    function _migrateCollateral(address user, address comet, MorphoCollateral memory collateral) internal {
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
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);
            uint256 amountOut = _swapCollateralToCompoundToken(
                ISwapRouter.ExactInputParams({
                    path: collateral.swapParams.path,
                    recipient: address(this),
                    amountIn: withdrawAmount,
                    amountOutMinimum: collateral.swapParams.amountOutMinimum,
                    deadline: block.timestamp
                })
            );
            IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);
            IComet(comet).supplyTo(user, tokenOut, amountOut);
            return;
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (collateralAsset == NATIVE_TOKEN) {
            // Wrap the native token
            WRAPPED_NATIVE_TOKEN.deposit{value: withdrawAmount}();
            // Approve the wrapped native token to be spent by Comet
            WRAPPED_NATIVE_TOKEN.approve(comet, withdrawAmount);
            IComet(comet).supplyTo(user, address(WRAPPED_NATIVE_TOKEN), withdrawAmount);
            return;
            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(collateralAsset).safeIncreaseAllowance(comet, withdrawAmount);
            IComet(comet).supplyTo(user, collateralAsset, withdrawAmount);
        }
    }

    /**
     * @notice Checks whether the user's debt position in a specific Morpho market is fully repaid.
     *
     * @dev Fetches the current `Position` data for the user in the given Morpho market ID.
     *      The function evaluates whether the user's `borrowShares` equals zero, indicating
     *      that the user has no remaining outstanding borrow debt in that market.
     *
     * @param id The market ID in Morpho for which the debt status is being checked.
     * @param user The address of the user whose debt is being verified.
     *
     * @return isCleared Boolean flag indicating whether the debt has been fully cleared (`true`)
     *         or if borrow shares are still present (`false`).
     */
    function _isDebtCleared(Id id, address user) internal view returns (bool isCleared) {
        // Get the user's current debt balance for the specified asset
        Position memory position = LENDING_POOL.position(id, user);
        // Debt is cleared if the total debt balance is zero
        return position.borrowShares == 0;
    }
}
