// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {ISparkPool} from "../interfaces/spark/ISparkPool.sol";
import {ISparkPoolDataProvider} from "../interfaces/spark/ISparkPoolDataProvider.sol";
import {IDebtToken} from "../interfaces/spark/IDebtToken.sol";
import {ISpToken} from "../interfaces/spark/ISpToken.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";

/**
 * @title SparkAdapter
 * @notice Adapter contract for migrating user positions from Spark Protocol into Compound III (Comet).
 *
 * @dev This contract implements the `IProtocolAdapter` interface and is intended to be used via
 *      `delegatecall` from the `MigratorV2` contract. It facilitates full or partial migration
 *      of user positions from the Spark Protocol to a target Compound III (Comet) market.
 *
 *      Core Responsibilities:
 *      - Decodes encoded user position data into borrow and collateral components.
 *      - Handles repayment of Spark variable-rate borrow positions using swapped assets.
 *      - Withdraws and migrates Spark collateral (spTokens) into the Comet market.
 *      - Optionally repays flash loans used during migration using contract funds or user’s Comet balance.
 *
 *      Key Components:
 *      - `executeMigration`: Main entry point (invoked by `MigratorV2`) that orchestrates full migration.
 *      - `_repayBorrow`: Repays Spark debt using available tokens or swapped assets; validates full repayment if required.
 *      - `_migrateCollateral`: Withdraws Spark collateral and supplies it to the Comet market, optionally swapping first.
 *      - `_repayFlashloan`: Handles repayment of Uniswap V3 flash loans, optionally pulling funds from the user’s Comet account.
 *      - `_isDebtCleared`: Verifies that a user’s debt has been fully repaid (for full migrations).
 *
 *      Swap Support:
 *      - Uses `SwapModule` to execute Uniswap V3 exact-input (collateral) and exact-output (borrow) swaps.
 *      - Swap parameters are passed via `SwapInputLimitParams` or `SwapOutputLimitParams`.
 *      - Supports dynamic routing and slippage protection for safe asset conversion.
 *
 *      Constructor Configuration:
 *      - Stores all parameters as immutable for gas optimization and read-only access.
 *
 *      Reentrancy:
 *      - Protected by `DelegateReentrancyGuard` to ensure secure delegatecall-based execution.
 *
 *      Requirements:
 *      - User must have approved this contract to move their spTokens and repay borrowings.
 *      - Swap parameters must be well-formed and safe for execution.
 *      - Flashloan logic assumes tokens can be withdrawn from user’s Comet balance if needed.
 *
 *      Limitations:
 *      - Only supports variable-rate borrowings (interestRateMode = 2).
 *      - No stablecoin conversion (e.g., DAI ⇄ USDS) is implemented in this adapter.
 *      - Intended for use only via delegatecall from `MigratorV2`.
 */
contract SparkAdapter is IProtocolAdapter, SwapModule {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Structure representing the deployment parameters for the SparkAdapter contract
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param daiUsdsConverter Address of the DAI to USDS converter contract
     * @param dai Address of the DAI token
     * @param usds Address of the USDS token
     * @param sparkLendingPool Address of the Spark Lending Pool contract
     * @param sparkDataProvider Address of the Spark Data Provider contract
     * @param isFullMigration Boolean indicating whether the migration is full or partial
     */
    struct DeploymentParams {
        address uniswapRouter;
        address sparkLendingPool;
        address sparkDataProvider;
        bool isFullMigration;
        bool useSwapRouter02;
    }

    /**
     * @notice Structure representing the user's position in Spark
     * @dev borrows Array of borrow positions to repay
     * @dev collateral Array of collateral positions to migrate
     */
    struct SparkPosition {
        SparkBorrow[] borrows;
        SparkCollateral[] collateral;
    }

    /**
     * @notice Structure representing an individual borrow position in Spark
     * @dev debtToken Address of the Spark variable debt token
     * @dev amount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct SparkBorrow {
        address debtToken;
        uint256 amount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Structure representing an individual collateral position in Spark
     * @dev spToken Address of the Spark spToken (collateral token)
     * @dev amount Amount of collateral to migrate; use `type(uint256).max` to migrate all
     */
    struct SparkCollateral {
        address spToken;
        uint256 amount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /// @notice Interest rate mode for variable-rate borrowings in Spark (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;

    /**
     * @notice Spark Lending Pool contract address
     */
    ISparkPool public immutable LENDING_POOL;

    /**
     * @notice Spark Data Provider contract address
     */
    ISparkPoolDataProvider public immutable DATA_PROVIDER;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the debt for a specific token has not been successfully cleared
     */
    error DebtNotCleared(address spToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SparkAdapter contract
     * @param deploymentParams Deployment parameters for the SparkAdapter contract:
     * - uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * - daiUsdsConverter Address of the DAI to USDS converter contract
     * - dai Address of the DAI token
     * - usds Address of the USDS token
     * - sparkLendingPool Address of the Spark Lending Pool contract
     * - sparkDataProvider Address of the Spark Data Provider contract
     * - isFullMigration Boolean indicating whether the migration is full or partial
     * @dev Reverts if any of the provided addresses are zero
     */
    constructor(
        DeploymentParams memory deploymentParams
    ) SwapModule(deploymentParams.uniswapRouter, deploymentParams.useSwapRouter02) {
        if (deploymentParams.sparkLendingPool == address(0) || deploymentParams.sparkDataProvider == address(0))
            revert InvalidZeroAddress();

        // if (deploymentParams.sparkLendingPool == deploymentParams.sparkDataProvider) revert IdenticalAddresses();

        LENDING_POOL = ISparkPool(deploymentParams.sparkLendingPool);
        DATA_PROVIDER = ISparkPoolDataProvider(deploymentParams.sparkDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's full or partial position from Spark to Compound III (Comet).
     *
     * @dev This function performs the full migration flow in sequential steps:
     *  1. Decodes the ABI-encoded `migrationData` into a `SparkPosition` struct, which contains the user's
     *     active borrow positions and collateral balances in the Spark protocol.
     *  2. Iterates through each borrow position and calls `_repayBorrow()`:
     *     - If necessary, tokens are acquired via Uniswap V3 swaps using provided `swapParams`.
     *     - The borrow is repaid through Spark's lending pool.
     *     - If `IS_FULL_MIGRATION` is set, debt clearance is validated post-repayment.
     *  3. Iterates through each collateral entry and calls `_migrateCollateral()`:
     *     - Withdraws the underlying asset from Spark.
     *     - Supplies the resulting tokens to the specified Compound III market via `supplyTo()`.
     *  4. If `flashloanData` is provided (non-empty), `_repayFlashloan()` is called to repay any flash loan
     *     used for liquidity during migration. The repayment may draw funds from the contract or from the user's
     *     Compound III balance via `withdrawFrom()`.
     *
     * @param user The address of the user whose Spark position is being migrated.
     * @param comet The address of the destination Compound III (Comet) market where assets are deposited.
     * @param migrationData ABI-encoded `SparkPosition` struct with:
     *        - An array of `SparkBorrow` positions (debts to repay).
     *        - An array of `SparkCollateral` positions (assets to migrate).
     * @param flashloanData ABI-encoded flash loan repayment parameters, or empty bytes if unused.
     *
     * Requirements:
     * - This contract must have the necessary approvals to interact with user's Spark tokens.
     * - If swap logic is involved, Uniswap router must be properly configured.
     * - The user must have sufficient liquidity in Spark and/or Compound III for withdrawal/repayment steps.
     *
     * @dev This function is guarded against reentrancy via `nonReentrant`.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData,
        uint256 preBaseAssetBalance
    ) external {
        // Decode the migration data into an SparkPosition struct
        SparkPosition memory position = abi.decode(migrationData, (SparkPosition));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            _repayBorrow(user, position.borrows[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collateral.length; i++) {
            _migrateCollateral(user, comet, position.collateral[i]);
        }

        // Repay the flash loan if it has been used
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData, preBaseAssetBalance);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool during Spark → Compound III migration.
     *
     * @dev This function ensures full repayment of the borrowed flash loan amount plus associated fees.
     * If the contract's balance of the borrowed token (`flashBaseToken`) is insufficient to cover the total repayment
     * (`flashAmountWithFee`), the contract attempts to withdraw the shortfall from the user’s Comet account.
     *
     * This method supports both:
     * - Direct repayment using contract-held tokens, and
     * - Indirect repayment by withdrawing the deficit from the user's Compound III balance.
     *
     * No token conversion is handled at this stage; it assumes the repayment must be in the original `flashBaseToken`.
     *
     * @param user The address of the user whose Compound III (Comet) balance may be used to cover any shortfall.
     * @param comet The address of the Compound III (Comet) contract holding the user’s balance.
     * @param flashloanData ABI-encoded tuple of:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that provided the flash loan.
     *        - `flashBaseToken` (address): The token borrowed and to be repaid.
     *        - `flashAmountWithFee` (uint256): The total repayment amount, including any associated flash loan fee.
     *
     * Requirements:
     * - The contract must repay the exact `flashAmountWithFee` in the `flashBaseToken`.
     * - If balance is insufficient, the user must have enough in their Comet balance for withdrawal.
     *
     * Effects:
     * - May call `withdrawFrom()` to transfer tokens from the user's Comet account to this contract.
     * - Ends with a `safeTransfer()` of the repayment amount to the Uniswap pool.
     *
     * Reverts:
     * - If the flash loan cannot be fully repaid due to insufficient contract or user balance.
     */
    function _repayFlashloan(
        address user,
        address comet,
        bytes calldata flashloanData,
        uint256 preBaseAssetBalance
    ) internal {
        (address flashLiquidityPool, IERC20 flashBaseToken, uint256 flashAmountWithFee) = abi.decode(
            flashloanData,
            (address, IERC20, uint256)
        );

        address executor = address(this);
        uint256 ownBaseTokenBalance = flashBaseToken.balanceOf(executor);

        IERC20 cometBaseToken = IComet(comet).baseToken();

        if (ownBaseTokenBalance < flashAmountWithFee) {
            // Calculate the amount to withdraw from the user's Comet account
            uint256 withdrawAmount = _calculateWithdrawAmount(comet, user, ownBaseTokenBalance, flashAmountWithFee);

            // Withdraw the required amount from the user's Comet account
            IComet(comet).withdrawFrom(user, executor, flashBaseToken, withdrawAmount);
        }

        // Repay the flash loan
        flashBaseToken.safeTransfer(flashLiquidityPool, flashAmountWithFee);

        // Check residual base asset balance
        uint256 residualBaseAsset = cometBaseToken.balanceOf(executor) - preBaseAssetBalance;

        // If there is a residual base asset balance, supply it back to the user's Comet account
        if (residualBaseAsset > 0) {
            cometBaseToken.safeIncreaseAllowance(comet, residualBaseAsset);
            IComet(comet).supplyTo(user, cometBaseToken, residualBaseAsset);
        }
    }

    function _calculateWithdrawAmount(
        address comet,
        address user,
        uint256 ownBaseTokenBalance,
        uint256 repayFlashloanAmount
    ) internal view returns (uint256 withdrawAmount) {
        uint256 userBalanceBaseToken = IComet(comet).balanceOf(user);
        uint256 baseBorrowMin = IComet(comet).baseBorrowMin();
        uint256 shortfallAmount = repayFlashloanAmount - ownBaseTokenBalance;

        if (
            (userBalanceBaseToken == 0 && baseBorrowMin <= shortfallAmount) ||
            userBalanceBaseToken > shortfallAmount ||
            ((shortfallAmount > userBalanceBaseToken ? (shortfallAmount - userBalanceBaseToken) : 0) > baseBorrowMin)
        ) {
            withdrawAmount = shortfallAmount;
        } else if (shortfallAmount > userBalanceBaseToken && baseBorrowMin > userBalanceBaseToken) {
            withdrawAmount = (baseBorrowMin - userBalanceBaseToken) + shortfallAmount;
        } else {
            withdrawAmount = baseBorrowMin;
        }
    }

    /**
     * @notice Repays a user's borrow position on the Spark protocol as part of a migration to Compound III.
     *
     * @dev This function determines the repayment amount and ensures that the user’s variable-rate debt
     * on Spark is covered either fully or partially. It supports flexible repayment logic through optional
     * token swaps or conversions:
     *
     * 1. If `borrow.amount == type(uint256).max`, the function interprets this as a request to repay the full
     *    outstanding variable debt for the specified `debtToken`.
     * 2. If a swap is required (`swapParams.path.length > 0`), the function:
     *    - Executes a Uniswap V3 exact-output swap to acquire the necessary amount of the `debtToken`.
     *    - The swap parameters are passed via `swapParams`.
     * 3. Retrieves the underlying asset address associated with the `debtToken`.
     * 4. Approves the Spark Lending Pool to pull the repayment amount from this contract.
     * 5. Calls `repay()` on Spark, paying the debt on behalf of the user.
     * 6. If `IS_FULL_MIGRATION` is enabled, the function verifies that the entire debt is cleared by calling
     *    `_isDebtCleared()` and reverts with `DebtNotCleared()` if any remaining balance is detected.
     *
     * @param user The address of the user whose Spark borrow position is being repaid.
     * @param borrow A struct containing:
     *        - `debtToken`: Address of the Spark variable debt token to repay.
     *        - `amount`: The repayment amount. Use `type(uint256).max` for full debt repayment.
     *        - `swapParams`: Optional parameters for performing a token swap before repayment.
     *
     * Requirements:
     * - If `swapParams` is provided, the Uniswap path must be valid.
     * - The user must have outstanding variable debt in Spark for the specified token.
     * - If `IS_FULL_MIGRATION == true`, all outstanding debt must be fully cleared.
     *
     * Effects:
     * - May invoke an on-chain swap to acquire the repayment token.
     * - Transfers the repayment token to Spark and repays the user’s debt.
     * - Validates debt clearance for full migrations.
     *
     * Reverts:
     * - `DebtNotCleared()` if residual debt remains after a full migration.
     */
    function _repayBorrow(address user, SparkBorrow memory borrow) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.debtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            // Perform a swap to obtain the borrow token using the provided swap parameters
            _swapFlashloanToBorrowToken(
                ISwapRouter.ExactOutputParams({
                    path: borrow.swapParams.path,
                    recipient: address(this),
                    amountOut: repayAmount,
                    amountInMaximum: borrow.swapParams.amountInMaximum,
                    deadline: block.timestamp
                })
            );
        }

        // Get the underlying asset address of the debt token
        IERC20 underlyingAsset = IDebtToken(borrow.debtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Spark Lending Pool to spend the repayment amount
        underlyingAsset.safeIncreaseAllowance(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(user, underlyingAsset)) revert DebtNotCleared(borrow.debtToken);
    }

    /**
     * @notice Migrates a user's collateral position from the Spark protocol to Compound III (Comet).
     *
     * @dev This function withdraws a specified amount of collateral from Spark and supplies it to the
     * target Compound III market. The migration logic adapts based on the type of asset and the presence
     * of swap instructions:
     *
     * 1. If `collateral.amount == type(uint256).max`, the function treats this as a request to migrate
     *    the user's full spToken balance.
     * 2. Transfers the user's `spToken` to the adapter contract.
     * 3. Determines the underlying asset associated with the `spToken`.
     * 4. Withdraws the underlying collateral from Spark using `LENDING_POOL.withdraw()`.
     * 5. Handles token preparation for Compound III based on `swapParams`:
     *    - If `swapParams.path.length > 0`, performs a Uniswap V3 exact-input swap to acquire the
     *      desired token for the target market.
     *    - Otherwise, supplies the underlying token directly.
     * 6. In all cases, the resulting token is approved for `comet` and supplied to the target market
     *    on behalf of the user via `supplyTo()`.
     *
     * @param user The address of the user whose collateral is being migrated from Spark.
     * @param comet The address of the Compound III (Comet) market receiving the collateral.
     * @param collateral Struct containing:
     *        - `spToken`: The Spark collateral token (spToken) to be migrated.
     *        - `amount`: Amount of collateral to migrate. Use `type(uint256).max` to migrate full balance.
     *        - `swapParams`: Optional parameters for Uniswap V3 swaps to convert the asset before deposit.
     *
     * Requirements:
     * - The user must have approved this contract to transfer their spTokens.
     * - If a swap is requested, `swapParams.path` must be valid.
     *
     * Effects:
     * - Transfers collateral from the user.
     * - Withdraws the equivalent underlying token from Spark.
     * - Swaps or wraps the token if necessary.
     * - Supplies the resulting token to Compound III for the user.
     */
    function _migrateCollateral(address user, address comet, SparkCollateral memory collateral) internal {
        // Determine the amount of collateral to migrate. If max value, migrate the full collateral balance
        uint256 spTokenAmount = collateral.amount == type(uint256).max
            ? ISpToken(collateral.spToken).balanceOf(user)
            : collateral.amount;
        // Transfer the collateral tokens from the user to this contract
        ISpToken(collateral.spToken).transferFrom(user, address(this), spTokenAmount);
        // Get the underlying asset address of the collateral token
        IERC20 underlyingAsset = ISpToken(collateral.spToken).UNDERLYING_ASSET_ADDRESS();
        // Withdraw the collateral from Spark
        LENDING_POOL.withdraw(underlyingAsset, spTokenAmount, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            IERC20 tokenOut = _decodeTokenOut(collateral.swapParams.path);

            uint256 amountOut = _swapCollateralToCompoundToken(
                ISwapRouter.ExactInputParams({
                    path: collateral.swapParams.path,
                    recipient: address(this),
                    amountIn: spTokenAmount,
                    amountOutMinimum: collateral.swapParams.amountOutMinimum,
                    deadline: collateral.swapParams.deadline
                })
            );
            tokenOut.safeIncreaseAllowance(comet, amountOut);
            IComet(comet).supplyTo(user, tokenOut, amountOut);

            // If no swap is required, supply the collateral directly to Comet
        } else {
            underlyingAsset.safeIncreaseAllowance(comet, spTokenAmount);
            IComet(comet).supplyTo(user, underlyingAsset, spTokenAmount);
        }
    }

    /**
     * @notice Checks whether the user's debt position for a specific asset in Spark is fully repaid.
     *
     * @dev Queries the Spark Data Provider to retrieve the user's reserve data for the specified asset.
     *      Extracts both stable and variable debt amounts and returns `true` only if their sum is zero.
     *      This check is typically used during full migration to ensure no residual debt remains.
     *
     * @param user The address of the user whose debt status is being checked.
     * @param asset The address of the underlying asset in Spark (e.g., DAI, USDC, etc.).
     *
     * @return isCleared A boolean value indicating whether the total debt (stable + variable)
     *         for the specified asset is fully cleared. Returns `true` if repaid, `false` otherwise.
     */
    function _isDebtCleared(address user, IERC20 asset) internal view returns (bool isCleared) {
        // Get the user's current debt balance for the specified asset
        (, , uint256 currentVariableDebt, , , , , , ) = DATA_PROVIDER.getUserReserveData(asset, user);
        // Debt is cleared if the debt balance is zero
        isCleared = (currentVariableDebt == 0);
    }
}
