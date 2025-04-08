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
import {ConvertModule} from "../modules/ConvertModule.sol";

/**
 * @title SparkUsdsAdapter
 * @notice Adapter contract for migrating user positions from Spark Protocol to Compound III (Comet), with USDS-specific logic.
 *
 * @dev This adapter implements `IProtocolAdapter` and is intended for use via `delegatecall` from the `MigratorV2` contract.
 *      It is specifically designed to support migrations where the target Compound III market uses USDS as the base asset.
 *      The adapter builds upon `SwapModule` for Uniswap V3 token swaps and `ConvertModule` to handle stablecoin conversions between DAI and USDS.
 *
 *      Key Capabilities:
 *      - Repayment of Spark variable debt using either pre-held tokens, swapped assets, or USDS → DAI conversions.
 *      - Withdrawal and migration of Spark collateral (spTokens) into the target Comet market, including:
 *          - Token swaps (via Uniswap V3),
 *          - Native token wrapping (ETH → WETH),
 *          - DAI → USDS conversion (for USDS-based markets).
 *      - Flash loan repayment support for liquidity management during migrations, with fallback withdrawals from user balances in Comet.
 *      - Full or partial migrations, enforced via the `isFullMigration` deployment flag.
 *      - Reverts on incomplete debt repayment if full migration is required.
 *
 *      Architecture Notes:
 *      - All swap/conversion logic is encapsulated within inherited `SwapModule` and `ConvertModule`.
 *      - Migration data is passed as ABI-encoded structs representing the user’s debt and collateral positions.
 *      - Flash loan data is optional and handled separately for flexible integration.
 *      - Uses `DelegateReentrancyGuard` to prevent reentrant delegatecall execution.
 *
 *      Requirements:
 *      - User must approve this contract to transfer spTokens and act on their behalf in Spark.
 *      - Uniswap router and DAI ⇄ USDS converter must be deployed and properly configured.
 *      - Comet market must support USDS directly or via proxy DAI.
 *
 *      Limitations:
 *      - Only variable-rate debts (interestRateMode = 2) are supported.
 *      - No support for stable-rate debt.
 *      - Contract must be called via delegatecall and not directly.
 */
contract SparkUsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Struct for initializing deployment parameters of the adapter.
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract.
     * @param daiUsdsConverter Address of the DAI-USDS converter contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     * @param sparkLendingPool Address of the Spark Lending Pool.
     * @param sparkDataProvider Address of the Spark Data Provider.
     * @param isFullMigration Flag indicating whether the migration requires all debt to be cleared.
     */
    struct DeploymentParams {
        address uniswapRouter;
        address daiUsdsConverter;
        address dai;
        address usds;
        address sparkLendingPool;
        address sparkDataProvider;
        bool isFullMigration;
    }

    /**
     * @notice Struct representing full user position in Spark.
     * @param borrows Borrow positions to be repaid.
     * @param collateral Collateral positions to be withdrawn and migrated.
     */
    struct SparkPosition {
        SparkBorrow[] borrows;
        SparkCollateral[] collateral;
    }

    /**
     * @notice Struct representing a single borrow to repay.
     * @param debtToken Spark debt token address.
     * @param amount Amount to repay (use type(uint256).max for full amount).
     * @param swapParams Parameters to obtain repay token (e.g., USDS → DAI).
     */
    struct SparkBorrow {
        address debtToken;
        uint256 amount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Struct representing a single collateral to migrate.
     * @param spToken Spark spToken address.
     * @param amount Amount to migrate (use type(uint256).max for full amount).
     * @param swapParams Parameters to convert to Compound-compatible token.
     */
    struct SparkCollateral {
        address spToken;
        uint256 amount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    uint8 private constant CONVERT_PATH_LENGTH = 40;

    /// @notice Interest rate mode for variable-rate borrowings in Spark (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;

    /// @notice Spark Lending Pool contract address
    ISparkPool public immutable LENDING_POOL;

    /// @notice Spark Data Provider contract address
    ISparkPoolDataProvider public immutable DATA_PROVIDER;

    /// --------Errors-------- ///

    /// @dev Reverts if the debt for a specific token has not been successfully cleared
    error DebtNotCleared(address spToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the SparkUsdsAdapter contract
     * @param deploymentParams Deployment parameters for the SparkUsdsAdapter contract:
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
    )
        SwapModule(deploymentParams.uniswapRouter)
        ConvertModule(deploymentParams.daiUsdsConverter, deploymentParams.dai, deploymentParams.usds)
    {
        if (deploymentParams.sparkLendingPool == address(0) || deploymentParams.sparkDataProvider == address(0))
            revert InvalidZeroAddress();

        LENDING_POOL = ISparkPool(deploymentParams.sparkLendingPool);
        DATA_PROVIDER = ISparkPoolDataProvider(deploymentParams.sparkDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's full or partial position from Spark to Compound III (Comet).
     *
     * @dev This function performs the following steps:
     *  1. Decodes the encoded `migrationData` into a `SparkPosition` struct that includes the user's
     *     outstanding borrow positions and collateral balances in Spark.
     *  2. Iterates over each borrow position and invokes `_repayBorrow`, which handles repayment logic,
     *     including token swaps or stablecoin conversions if necessary.
     *  3. Iterates over each collateral item and calls `_migrateCollateral` to withdraw the user's assets
     *     from Spark and deposit them into Compound III. This step may involve:
     *     - Converting tokens (e.g., DAI → USDS),
     *     - Performing Uniswap V3 swaps,
     *     - Wrapping native tokens into their ERC-20 equivalents (e.g., ETH → WETH).
     *  4. If `flashloanData` is provided, the function invokes `_repayFlashloan` to settle the flash loan debt.
     *     Repayment can happen from contract balance or by withdrawing the needed amount from the user’s
     *     balance in Compound III.
     *
     * @param user The address of the user whose Spark position is being migrated.
     * @param comet The address of the target Compound III (Comet) market to receive the migrated assets.
     * @param migrationData ABI-encoded `SparkPosition` struct containing:
     *        - An array of `SparkBorrow` items to repay.
     *        - An array of `SparkCollateral` items to migrate.
     * @param flashloanData ABI-encoded data used to repay a Uniswap V3 flash loan if one was taken.
     *        Pass an empty bytes value if no flash loan is used (e.g., for collateral-only migrations).
     *
     * @dev This function is protected by a nonReentrant modifier to prevent reentrancy attacks.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData
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

        // Repay flashloan
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool.
     *
     * @dev This function ensures that the borrowed flash loan amount, including its associated fee,
     * is fully repaid to the originating liquidity pool. If the contract's balance of the
     * `flashBaseToken` is insufficient, it attempts to withdraw the shortfall from the user's
     * Comet balance. If the flash loan was taken in DAI but the Comet market uses USDS as its base
     * token, the contract first withdraws USDS and converts it to DAI before repayment.
     *
     * This repayment strategy supports both direct base token usage and proxy repayment using
     * USDS-DAI conversion for USDS-based markets.
     *
     * @param user The address of the user whose Compound III (Comet) balance may be used to cover the shortfall.
     * @param comet The address of the Compound III (Comet) market associated with the user's position.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that provided the flash loan.
     *        - `flashBaseToken` (address): The token borrowed via the flash loan.
     *        - `flashAmountWithFee` (uint256): The total amount to repay, including fees.
     *
     * Requirements:
     * - The contract must ensure full repayment of `flashAmountWithFee` in `flashBaseToken`.
     * - If the contract's balance is insufficient, it must withdraw the difference from the user's Comet account.
     * - If the repayment token is DAI and the market uses USDS, conversion must occur prior to transfer.
     *
     * Effects:
     * - May withdraw assets from the user’s Compound III account using `withdrawFrom()`.
     * - May trigger `_convertUsdsToDai()` if conversion is necessary.
     * - Ends with `safeTransfer` to the liquidity pool, repaying the flash loan.
     */
    function _repayFlashloan(address user, address comet, bytes calldata flashloanData) internal {
        (address flashLiquidityPool, address flashBaseToken, uint256 flashAmountWithFee) = abi.decode(
            flashloanData,
            (address, address, uint256)
        );

        address executor = address(this);
        uint256 balance = IERC20(flashBaseToken).balanceOf(executor);

        if (balance < flashAmountWithFee) {
            address cometBaseToken = IComet(comet).baseToken();
            // If the flash loan token is DAI and the Comet base token is USDS, convert USDS to DAI
            if (cometBaseToken == USDS && flashBaseToken == DAI) {
                IComet(comet).withdrawFrom(user, executor, USDS, (flashAmountWithFee - balance));
                _convertUsdsToDai(flashAmountWithFee - balance);
            } else {
                // Withdraw the required amount from the user's Comet account
                IComet(comet).withdrawFrom(user, executor, cometBaseToken, (flashAmountWithFee - balance));
            }
        }
        // Repay the flash loan
        IERC20(flashBaseToken).safeTransfer(flashLiquidityPool, flashAmountWithFee);
    }

    /**
     * @notice Repays a borrow position held by the user on Spark protocol.
     *
     * @dev This function repays a variable debt position from the user's Spark account.
     * It supports flexible repayment strategies, including full or partial debt coverage.
     * If repayment requires acquiring a specific token (debtToken), a swap or conversion
     * is performed prior to repayment:
     *
     * - If the user’s borrow specifies `amount == type(uint256).max`, the contract treats this
     *   as a request to repay the entire outstanding debt.
     * - If `swapParams.path` is provided, the contract either:
     *     - Converts USDS to DAI directly using `_convertUsdsToDai()` (for Spark USDS-based markets), or
     *     - Performs an exact-output swap on Uniswap V3 to acquire the required debt token.
     * - After obtaining the repayment token, the contract increases allowance to the Spark
     *   Lending Pool and calls `repay()` on behalf of the user.
     *
     * Additionally, if the migration mode is full, it verifies whether the debt has been
     * completely cleared using `_isDebtCleared()` and reverts with `DebtNotCleared()` if not.
     *
     * @param user The address of the user whose Spark borrow position is being repaid.
     * @param borrow Struct containing:
     *        - `debtToken`: Address of the Spark variable debt token to repay.
     *        - `amount`: The amount of debt to repay. Use `type(uint256).max` for full repayment.
     *        - `swapParams`: Parameters to define token swap logic (optional).
     *
     * Requirements:
     * - If a swap is required, `swapParams.path` must be valid and match expected input/output tokens.
     * - The user must hold sufficient Spark debt and allow repayment on their behalf.
     * - If in full migration mode, the debt must be fully cleared after repayment.
     *
     * Effects:
     * - Performs token conversion or swap if necessary.
     * - Transfers repayment tokens to the Spark pool.
     * - Verifies debt clearance post-repayment if `IS_FULL_MIGRATION` is set.
     */
    function _repayBorrow(address user, SparkBorrow memory borrow) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.debtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(borrow.swapParams.path);
            address tokenOut = _decodeTokenOut(borrow.swapParams.path);

            if (
                tokenIn == ConvertModule.USDS &&
                tokenOut == ConvertModule.DAI &&
                borrow.swapParams.path.length == CONVERT_PATH_LENGTH
            ) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(repayAmount);
            } else if (
                tokenIn == ConvertModule.DAI &&
                tokenOut == ConvertModule.USDS &&
                borrow.swapParams.path.length == CONVERT_PATH_LENGTH
            ) {
                // Convert DAI to USDS for repayment
                _convertDaiToUsds(repayAmount);
            } else {
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
        }

        // Get the underlying asset address of the debt token
        address underlyingAsset = IDebtToken(borrow.debtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Spark Lending Pool to spend the repayment amount
        IERC20(underlyingAsset).safeIncreaseAllowance(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(user, underlyingAsset)) revert DebtNotCleared(borrow.debtToken);
    }

    /**
     * @notice Migrates a user's collateral position from the Spark protocol to Compound III (Comet).
     *
     * @dev This function withdraws the specified collateral from Spark, optionally swaps it to a
     * supported token in the Comet market, and deposits it into the target Compound III market
     * on behalf of the user.
     *
     * Migration strategies supported:
     * - Full or partial migration of collateral.
     * - Direct supply of the underlying asset if no swap is needed.
     * - Token swap using Uniswap V3 for cases when the Spark collateral must be converted
     *   to a supported token in Compound III.
     * - Special handling for native token wrapping (e.g., ETH → WETH).
     * - USDS migration via DAI proxy mechanism:
     *     - If the swap result is DAI and the Compound market uses USDS as base token,
     *       DAI is converted to USDS before supply.
     *
     * @param user The address of the user whose collateral is being migrated.
     * @param comet The address of the Compound III (Comet) market to which the collateral is supplied.
     * @param collateral Struct describing the Spark collateral position:
     *        - `spToken`: The Spark spToken address representing the collateral.
     *        - `amount`: The amount of collateral to migrate (can be `type(uint256).max` for full).
     *        - `swapParams`: Optional parameters defining swap path and limits.
     *
     * Requirements:
     * - The user must approve the contract to transfer their `spToken`.
     * - If `swapParams.path.length > 0`, it must be valid and executable.
     * - If underlying token is native (ETH), the contract will automatically wrap it.
     * - For DAI → USDS conversion, `ConvertModule` must be configured with valid converter.
     *
     * Effects:
     * - Transfers and withdraws collateral from Spark.
     * - Optionally swaps/unwraps/wraps/convert tokens to match Comet's requirements.
     * - Supplies resulting asset to Comet market on behalf of the user.
     */
    function _migrateCollateral(address user, address comet, SparkCollateral memory collateral) internal {
        // Determine the amount of collateral to migrate. If max value, migrate the full collateral balance
        uint256 spTokenAmount = collateral.amount == type(uint256).max
            ? ISpToken(collateral.spToken).balanceOf(user)
            : collateral.amount;
        // Transfer the collateral tokens from the user to this contract
        ISpToken(collateral.spToken).transferFrom(user, address(this), spTokenAmount);
        // Get the underlying asset address of the collateral token
        address underlyingAsset = ISpToken(collateral.spToken).UNDERLYING_ASSET_ADDRESS();
        // Withdraw the collateral from Spark
        LENDING_POOL.withdraw(underlyingAsset, spTokenAmount, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(collateral.swapParams.path);
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(spTokenAmount);
                IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, spTokenAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, spTokenAmount);
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: collateral.swapParams.path,
                        recipient: address(this),
                        amountIn: spTokenAmount,
                        amountOutMinimum: collateral.swapParams.amountOutMinimum,
                        deadline: block.timestamp
                    })
                );

                if (tokenOut == ConvertModule.DAI && IComet(comet).baseToken() == ConvertModule.USDS) {
                    _convertDaiToUsds(amountOut);
                    IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, ConvertModule.USDS, amountOut);
                } else {
                    IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, tokenOut, amountOut);
                }
            }

            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(underlyingAsset).safeIncreaseAllowance(comet, spTokenAmount);
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
    function _isDebtCleared(address user, address asset) internal view returns (bool isCleared) {
        // Get the user's current debt balance for the specified asset
        (, uint256 currentStableDebt, uint256 currentVariableDebt, , , , , , ) = DATA_PROVIDER.getUserReserveData(
            asset,
            user
        );
        // Debt is cleared if the total debt balance is zero
        return (currentStableDebt + currentVariableDebt) == 0;
    }
}
