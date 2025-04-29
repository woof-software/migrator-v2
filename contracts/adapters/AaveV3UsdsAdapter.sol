// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IAavePool} from "../interfaces/aave/IAavePool.sol";
import {IAavePoolDataProvider} from "../interfaces/aave/IAavePoolDataProvider.sol";
import {IDebtToken} from "../interfaces/aave/IDebtToken.sol";
import {IAToken} from "../interfaces/aave/IAToken.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";

/**
 * @title AaveV3UsdsAdapter
 * @notice Adapter contract for migrating user positions from Aave V3 to Compound III (Comet), with support for USDS-based markets.
 *
 * @dev This contract implements the `IProtocolAdapter` interface and integrates the `SwapModule` and `ConvertModule`
 *      to facilitate seamless migration of debt and collateral positions. It supports token swaps via Uniswap V3
 *      and stablecoin conversions (DAI ⇄ USDS) for USDS-based Compound III markets.
 *
 * Core Responsibilities:
 * - Decodes user positions (borrows and collaterals) from encoded calldata.
 * - Handles repayment of variable-rate debt positions in Aave V3.
 * - Executes token swaps or stablecoin conversions as needed for repayment or migration.
 * - Withdraws and optionally converts Aave collateral tokens before supplying them to Compound III.
 * - Supports Uniswap-based flash loan repayments with fallback logic to pull funds from the user's Comet balance.
 *
 * USDS-Specific Logic:
 * - Converts DAI to USDS when migrating to USDS-based Comet markets.
 * - Converts USDS to DAI when repaying flash loans borrowed in DAI for USDS Comet markets.
 * - Automatically detects when stablecoin conversion is required based on swap paths and base tokens.
 *
 * Key Components:
 * - `executeMigration`: Entry point for coordinating the full migration flow.
 * - `_repayBorrow`: Handles repayment of Aave V3 debt, optionally performing swaps or conversions.
 * - `_migrateCollateral`: Withdraws and optionally converts Aave collateral into Comet-compatible tokens.
 * - `_repayFlashloan`: Repays flash loans using contract balance or by withdrawing from the user's Comet account.
 * - `_isDebtCleared`: Verifies whether a specific Aave V3 debt position has been fully repaid.
 *
 * Constructor Configuration:
 * - Accepts Uniswap router, stablecoin converter, token addresses, Aave contracts, and a full migration flag.
 * - Stores all parameters as immutable for gas efficiency and safety.
 *
 * Requirements:
 * - User must approve this contract to transfer relevant aTokens and debtTokens.
 * - Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
 * - Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).
 *
 * Limitations:
 * - Supports only variable-rate Aave debt (interestRateMode = 2).
 * - Only DAI ⇄ USDS conversions are supported for USDS-based Comet markets.
 * - Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`.
 */
contract AaveV3UsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Struct for initializing deployment parameters of the adapter.
     *
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract.
     * @param daiUsdsConverter Address of the DAI ⇄ USDS converter contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     * @param aaveLendingPool Address of the Aave V3 Lending Pool contract.
     * @param aaveDataProvider Address of the Aave V3 Data Provider contract.
     * @param isFullMigration Boolean flag indicating whether the migration requires all debt to be cleared.
     * @param useSwapRouter02 Boolean flag indicating whether to use Uniswap V3 SwapRouter02.
     *
     * @dev This struct encapsulates all the necessary parameters required to deploy the `AaveV3UsdsAdapter` contract.
     *      It ensures that the adapter is properly configured with the required external contract addresses and settings.
     */
    struct DeploymentParams {
        address uniswapRouter;
        address daiUsdsConverter;
        address dai;
        address usds;
        address aaveLendingPool;
        address aaveDataProvider;
        bool isFullMigration;
        bool useSwapRouter02;
    }

    /**
     * @notice Struct representing a user's full position in Aave V3, including borrow and collateral details.
     *
     * @param borrows An array of `AaveV3Borrow` structs representing the user's borrow positions to be repaid.
     * @param collaterals An array of `AaveV3Collateral` structs representing the user's collateral positions to be migrated.
     *
     * @dev This struct is used to encapsulate all the necessary information about a user's Aave V3 position,
     *      enabling seamless migration of both debt and collateral to Compound III (Comet).
     */
    struct AaveV3Position {
        AaveV3Borrow[] borrows;
        AaveV3Collateral[] collaterals;
    }

    /**
     * @notice Struct representing a single borrow position to repay in Aave V3.
     *
     * @param debtToken The address of the Aave V3 variable debt token to be repaid.
     * @param amount The amount of debt to repay. Use `type(uint256).max` to repay the full debt balance.
     * @param swapParams Parameters for obtaining the repayment token, including:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `amountInMaximum`: The maximum amount of input tokens that can be spent during the swap.
     *        - `deadline`: The timestamp by which the swap must be completed.
     *
     * @dev This struct is used to define the details of a borrow position, including the debt token,
     *      the amount to repay, and optional swap parameters for acquiring the repayment token.
     */
    struct AaveV3Borrow {
        address debtToken;
        uint256 amount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Struct representing a single collateral position to migrate from Aave V3 to Compound III (Comet).
     *
     * @param aToken The address of the Aave aToken representing the collateral.
     * @param amount The amount of aToken to migrate. Use `type(uint256).max` to migrate the full balance.
     * @param swapParams Parameters for converting the collateral into a Compound-compatible token, including:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `amountOutMinimum`: The minimum amount of output tokens to be received.
     *        - `deadline`: The timestamp by which the swap must be completed.
     *
     * @dev This struct is used to define the details of a collateral position, including the token to migrate,
     *      the amount to migrate, and optional swap parameters for converting the collateral into a token
     *      compatible with the target Compound III market.
     */
    struct AaveV3Collateral {
        address aToken;
        uint256 amount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /**
     * @notice The fixed length of the token conversion path used for DAI ⇄ USDS conversions.
     * @dev This constant is used to validate the swap path length when performing stablecoin conversions
     *      between DAI and USDS in USDS-based Compound III (Comet) markets.
     */
    uint8 private constant CONVERT_PATH_LENGTH = 40;

    /**
     * @notice Interest rate mode for variable-rate borrowings in Aave V3.
     *
     * @dev This constant is set to `2`, which represents the variable interest rate mode in Aave V3.
     *      It is used when repaying borrow positions in the Aave V3 Lending Pool.
     */
    uint256 public constant INTEREST_RATE_MODE = 2;

    /**
     * @notice Boolean indicating whether the migration is a full migration.
     *
     * @dev This immutable variable determines if the migration process requires all debt positions
     *      to be fully cleared. If set to `true`, the contract ensures that all outstanding debt
     *      is repaid during the migration process. It is initialized during the deployment of the
     *      `AaveV3UsdsAdapter` contract.
     */ bool public immutable IS_FULL_MIGRATION;

    /**
     * @notice Aave V3 Lending Pool contract address.
     *
     * @dev This immutable variable holds the address of the Aave V3 Lending Pool, which is used to perform
     *      operations such as withdrawing collateral and repaying debt. It is initialized during the deployment
     *      of the `AaveV3UsdsAdapter` contract.
     */
    IAavePool public immutable LENDING_POOL;

    /**
     * @notice Aave V3 Data Provider contract address.
     *
     * @dev This immutable variable holds the address of the Aave V3 Data Provider, which is used to fetch
     *      user reserve data, including debt and collateral information. It is initialized during the deployment
     *      of the `AaveV3UsdsAdapter` contract.
     */
    IAavePoolDataProvider public immutable DATA_PROVIDER;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the debt for a specific token has not been successfully cleared.
     * @param aToken The address of the Aave aToken associated with the uncleared debt.
     *
     * @notice This error is triggered during a full migration when the user's debt for a specific asset
     *         in Aave V3 has not been fully repaid after the repayment process.
     */ error DebtNotCleared(address aToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the AaveV3UsdsAdapter contract with deployment parameters.
     *
     * @param deploymentParams Struct containing the following deployment parameters:
     *        - `uniswapRouter`: Address of the Uniswap V3 SwapRouter contract.
     *        - `daiUsdsConverter`: Address of the DAI ⇄ USDS converter contract (optional, can be zero address).
     *        - `dai`: Address of the DAI token (optional, can be zero address).
     *        - `usds`: Address of the USDS token (optional, can be zero address).
     *        - `aaveLendingPool`: Address of the Aave V3 Lending Pool contract.
     *        - `aaveDataProvider`: Address of the Aave V3 Data Provider contract.
     *        - `isFullMigration`: Boolean flag indicating whether the migration requires all debt to be cleared.
     *        - `useSwapRouter02`: Boolean flag indicating whether to use Uniswap V3 SwapRouter02.
     *
     * @dev The constructor initializes the `SwapModule` and `ConvertModule` with the provided Uniswap router
     *      and stablecoin converter addresses. It also validates that the Aave Lending Pool and Data Provider
     *      addresses are non-zero. All parameters are stored as immutable for gas efficiency and safety.
     *
     * Requirements:
     * - `aaveLendingPool` and `aaveDataProvider` must not be zero addresses.
     *
     * Warning:
     * - If `daiUsdsConverter`, `dai`, or `usds` are set to zero addresses, USDS-specific logic (e.g., DAI ⇄ USDS conversions)
     *   will not be supported. In this case, only standard token swaps will be available for migration.
     *
     * Reverts:
     * - {InvalidZeroAddress} if `aaveLendingPool` or `aaveDataProvider` is a zero address.
     */
    constructor(
        DeploymentParams memory deploymentParams
    )
        SwapModule(deploymentParams.uniswapRouter, deploymentParams.useSwapRouter02)
        ConvertModule(deploymentParams.daiUsdsConverter, deploymentParams.dai, deploymentParams.usds)
    {
        if (deploymentParams.aaveLendingPool == address(0) || deploymentParams.aaveDataProvider == address(0))
            revert InvalidZeroAddress();

        LENDING_POOL = IAavePool(deploymentParams.aaveLendingPool);
        DATA_PROVIDER = IAavePoolDataProvider(deploymentParams.aaveDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's full or partial position from Aave V3 to Compound III (Comet).
     *
     * @dev This function performs the following steps:
     *  1. Decodes the encoded `migrationData` into an `AaveV3Position` struct that contains information
     *     about the user's borrow and collateral positions.
     *  2. Iterates through each borrow and calls `_repayBorrow` to repay the user's debt on Aave V3.
     *     This may involve swaps or stablecoin conversions.
     *  3. Iterates through each collateral item and calls `_migrateCollateral` to withdraw it from Aave V3
     *     and supply it into the corresponding Compound III market. This may include swaps via Uniswap V3,
     *     or DAI ⇄ USDS conversions.
     *  4. If flash loan data is provided, it settles the flash loan debt via `_repayFlashloan`, either from
     *     contract balance or by withdrawing from the user's Compound III account.
     *
     * @param user The address of the user whose Aave V3 position is being migrated.
     * @param comet The address of the target Compound III (Comet) contract to receive the migrated assets.
     * @param migrationData ABI-encoded AaveV3Position struct that contains:
     *        - An array of AaveV3Borrow items representing debts to repay.
     *        - An array of AaveV3Collateral items representing collaterals to migrate.
     * @param flashloanData ABI-encoded data used to repay a Uniswap V3 flash loan if one was taken.
     *        Should be empty if no flash loan is used (e.g., in debt-free collateral migration).
     * @param preBaseAssetBalance The contract's base token balance before the migration process begins.
     *
     * Requirements:
     * - The user must have approved this contract to transfer their aTokens and debtTokens.
     * - The `migrationData` must be correctly encoded and represent valid Aave V3 positions.
     * - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment.
     *
     * Warning:
     * - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts.
     *
     * Reverts:
     * - If any borrow repayment, collateral migration, or flash loan repayment fails.
     * - If the migration process encounters invalid swap paths or insufficient allowances.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData,
        uint256 preBaseAssetBalance
    ) external {
        // Decode the migration data into an AaveV3Position struct
        AaveV3Position memory position = abi.decode(migrationData, (AaveV3Position));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            _repayBorrow(user, position.borrows[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collaterals.length; i++) {
            _migrateCollateral(user, comet, position.collaterals[i]);
        }

        // Repay the flash loan if it has been used
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData, preBaseAssetBalance);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool.
     *
     * @dev This function ensures that the borrowed flash loan amount, including its associated fee,
     *      is fully repaid to the original liquidity pool. If the contract's current balance in the
     *      `flashBaseToken` is insufficient, it attempts to cover the shortfall by withdrawing tokens
     *      from the user's Comet account. If the flash loan token is DAI while the Comet market uses
     *      USDS as its base token, a conversion from USDS to DAI is performed before repayment.
     *
     * Steps performed:
     * 1. Decodes the `flashloanData` to extract the flash loan pool, token, and repayment amount.
     * 2. Checks the contract's current balance of the flash loan token and calculates any shortfall.
     * 3. If a shortfall exists:
     *    - Calculates the amount to withdraw from the user's Comet account.
     *    - Withdraws the required amount from the user's Comet account.
     *    - Converts USDS to DAI if necessary for repayment.
     * 4. Transfers the full repayment amount (including fees) back to the flash loan pool.
     * 5. Supplies any residual base token balance back to the user's Comet account.
     *
     * @param user The address of the user whose Comet balance may be used to cover the flash loan repayment.
     * @param comet The address of the Compound III (Comet) market where the user's collateral or base token is stored.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that issued the flash loan.
     *        - `flashBaseToken` (IERC20): The token borrowed through the flash loan.
     *        - `flashAmountWithFee` (uint256): The total repayment amount, including the flash loan fee.
     * @param preBaseAssetBalance The contract's base token balance before the flash loan was taken.
     *
     * Requirements:
     * - The contract must repay the flash loan in `flashBaseToken`, even if it must convert assets to obtain it.
     * - If conversion is required (USDS → DAI), it must happen before the repayment.
     * - If withdrawal is needed, the user must have sufficient available balance in the Comet market.
     *
     * Reverts:
     * - If the flash loan repayment fails due to insufficient funds or allowance issues.
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
        uint256 ownBaseTokenBalance = flashBaseToken.balanceOf(executor) - preBaseAssetBalance;
        // Calculate the shortfall amount to be converted before repayment flashloan
        uint256 shortfallAmount = flashAmountWithFee - ownBaseTokenBalance;

        IERC20 cometBaseToken = IComet(comet).baseToken();

        if (ownBaseTokenBalance < flashAmountWithFee) {
            // Calculate the amount to withdraw from the user's Comet account
            uint256 withdrawAmount = _calculateWithdrawAmount(comet, user, ownBaseTokenBalance, flashAmountWithFee);

            // If the flash loan token is DAI and the Comet base token is USDS, convert USDS to DAI
            if (cometBaseToken == USDS && flashBaseToken == DAI) {
                IComet(comet).withdrawFrom(user, executor, USDS, withdrawAmount);
                _convertUsdsToDai(shortfallAmount);
            } else {
                // Withdraw the required amount from the user's Comet account
                IComet(comet).withdrawFrom(user, executor, flashBaseToken, withdrawAmount);
            }
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

    /**
     * @notice Calculates the amount of tokens to withdraw from the user's Compound III (Comet) account
     *         to cover a flash loan repayment shortfall.
     *
     * @dev This function determines the optimal withdrawal amount based on the user's current Comet balances,
     *      borrow limits, and the flash loan repayment requirements. It ensures that the user maintains the
     *      minimum borrow balance (`baseBorrowMin`) required by Comet after the transaction.
     *
     * @param comet Address of the Compound III (Comet) contract.
     * @param user Address of the user whose Comet account is being accessed.
     * @param ownBaseTokenBalance Current balance of the base token held by the contract.
     * @param repayFlashloanAmount Total amount required to repay the flash loan, including fees.
     *
     * @return withdrawAmount The amount of tokens to withdraw from the user's Comet account.
     *
     * Logic:
     * - If the user's Comet base token balance is sufficient to cover the shortfall, withdraw only the shortfall amount.
     * - If the user's projected borrow balance after the transaction meets or exceeds `baseBorrowMin`, withdraw the shortfall.
     * - If the user's projected borrow balance is below `baseBorrowMin`, calculate the additional amount needed to meet the minimum.
     * - If the user has no debt and the required amount is less than `baseBorrowMin`, withdraw the minimum borrow amount.
     *
     * Requirements:
     * - The user must have sufficient base token balance or borrowing capacity in their Comet account.
     *
     * Reverts:
     * - This function does not revert directly but relies on the caller to handle insufficient balances or borrowing capacity.
     */
    function _calculateWithdrawAmount(
        address comet,
        address user,
        uint256 ownBaseTokenBalance,
        uint256 repayFlashloanAmount
    ) internal view returns (uint256 withdrawAmount) {
        uint256 userCometBaseTokenBalance = IComet(comet).balanceOf(user);
        uint256 userCometBorrowBalance = IComet(comet).borrowBalanceOf(user);
        uint256 baseBorrowMin = IComet(comet).baseBorrowMin();
        uint256 borrowMinDelta = (userCometBorrowBalance < baseBorrowMin && userCometBorrowBalance != 0)
            ? (baseBorrowMin - userCometBorrowBalance)
            : baseBorrowMin;

        uint256 shortfallAmount = repayFlashloanAmount - ownBaseTokenBalance;

        // Case: the user already has a debt that covers the shortfall, or borrow >= borrowMinDelta
        uint256 projectedBorrow = shortfallAmount > userCometBaseTokenBalance
            ? shortfallAmount - userCometBaseTokenBalance
            : 0;

        if (userCometBaseTokenBalance >= shortfallAmount || projectedBorrow >= borrowMinDelta) {
            withdrawAmount = shortfallAmount;
        }
        // If projectedBorrow < borrowMinDelta, but the user already has a debt < borrowMinDelta,
        // then you need to borrow enough to have ≥ borrowMinDelta after the transaction
        else if (userCometBaseTokenBalance > 0 && projectedBorrow < borrowMinDelta) {
            withdrawAmount = shortfallAmount + (borrowMinDelta - projectedBorrow);
        }
        // If the user has no debt and needs less than borrowMinDelta, we take the minimum
        else {
            withdrawAmount = borrowMinDelta;
        }
    }

    /**
     * @notice Repays a user's borrow position on Aave V3 as part of the migration process.
     *
     * @dev This function determines the repayment amount (either specified or full),
     * optionally swaps tokens using Uniswap V3 or performs a DAI ⇄ USDS conversion,
     * then repays the user's debt position in Aave V3 using the lending pool.
     *
     * The borrow repayment is routed through the adapter, which may act on behalf of the user
     * using flash-loaned tokens or previously converted/supplied tokens.
     *
     * If the `IS_FULL_MIGRATION` flag is true, the function checks whether the entire debt
     * position has been successfully cleared post-repayment and reverts otherwise.
     *
     * @param user The address of the user whose debt is being repaid.
     * @param borrow Struct describing the debt position, including:
     *        - `debtToken`: Address of the Aave V3 variable debt token to be repaid.
     *        - `amount`: Amount of debt to repay. If set to `type(uint256).max`, repays full debt balance.
     *        - `swapParams`: Optional swap parameters to acquire `debtToken` (exact output swap or conversion).
     *
     * Swap Logic:
     * - If `swapParams.path.length > 0`, a swap is required.
     * - If the path implies DAI → USDS, `_convertDaiToUsds()` is invoked directly.
     * - If the path implies USDS → DAI, `_convertUsdsToDai()` is invoked directly.
     * - Otherwise, a Uniswap V3 swap is performed using `ExactOutputParams`.
     *
     * Repayment:
     * - The function extracts the underlying token of the `debtToken`.
     * - Approves the Aave LendingPool to spend `repayAmount`.
     * - Calls `repay()` on Aave with the user as the beneficiary.
     *
     * Post-checks:
     * - If `IS_FULL_MIGRATION` is true and residual debt remains, reverts with `DebtNotCleared`.
     *
     * Requirements:
     * - The user must have sufficient allowance or supply for debt repayment.
     * - If a swap is performed, the swap path and `amountInMaximum` must be valid.
     *
     * Reverts:
     * - If the full debt is not cleared during full migration.
     * - If token transfers, swaps, or approvals fail.
     */
    function _repayBorrow(address user, AaveV3Borrow memory borrow) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.debtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            IERC20 tokenIn = _decodeTokenIn(borrow.swapParams.path);
            IERC20 tokenOut = _decodeTokenOut(borrow.swapParams.path);
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
                        deadline: borrow.swapParams.deadline
                    })
                );
            }
        }

        // Get the underlying asset address of the debt token
        IERC20 underlyingAsset = IDebtToken(borrow.debtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Aave Lending Pool to spend the repayment amount
        underlyingAsset.safeIncreaseAllowance(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(user, underlyingAsset)) revert DebtNotCleared(borrow.debtToken);
    }

    /**
     * @notice Migrates a user's collateral position from Aave V3 to Compound III (Comet).
     *
     * @dev This function handles collateral withdrawal from Aave, optional swap or conversion
     * into the desired token, and final deposit into the target Compound III market.
     *
     * Steps performed:
     * 1. Determines the amount of aToken to migrate. If `collateral.amount == type(uint256).max`,
     *    the user's entire aToken balance is used.
     * 2. Transfers aTokens from the user to the contract.
     * 3. Calls Aave V3 LendingPool to withdraw the corresponding underlying asset.
     * 4. Depending on the `swapParams`, the function performs:
     *    - No swap: directly supplies the asset to Compound III.
     *    - DAI → USDS conversion via `_convertDaiToUsds()`, if required by the Comet market.
     *    - Swap via Uniswap V3 using `ExactInputParams`, followed by optional USDS conversion.
     *
     * Special handling:
     * - If the target Compound III market uses USDS and the user has DAI collateral,
     *   the contract automatically converts DAI to USDS.
     * - If `swapParams.path.length > 0`, it performs an on-chain token swap before depositing.
     *
     * @param user The address of the user whose collateral is being migrated.
     * @param comet The address of the Compound III (Comet) market where the collateral will be deposited.
     * @param collateral Struct describing the collateral position, including:
     *        - `aToken`: Address of the Aave aToken to be migrated.
     *        - `amount`: Amount of aToken to migrate. Use `type(uint256).max` to migrate full balance.
     *        - `swapParams`: Parameters describing the swap route (Uniswap V3) and minimum output.
     *
     * Requirements:
     * - The user must have approved this contract to transfer their aTokens.
     * - If a swap is required, the `path` must be correctly constructed.
     * - The Uniswap router must be set and operational for swap execution.
     *
     * Reverts:
     * - If swap fails or amountOut is below `amountOutMinimum`.
     * - If token transfers or approvals fail due to allowance issues.
     */
    function _migrateCollateral(address user, address comet, AaveV3Collateral memory collateral) internal {
        // Determine the amount of collateral to migrate. If max value, migrate the full collateral balance
        uint256 aTokenAmount = collateral.amount == type(uint256).max
            ? IAToken(collateral.aToken).balanceOf(user)
            : collateral.amount;

        // Transfer the collateral tokens from the user to this contract
        IAToken(collateral.aToken).transferFrom(user, address(this), aTokenAmount);
        // Get the underlying asset address of the collateral token
        IERC20 underlyingAsset = IAToken(collateral.aToken).UNDERLYING_ASSET_ADDRESS();
        // Get the base token of the Comet contract
        IERC20 baseToken = IComet(comet).baseToken();
        // Withdraw the collateral from Aave V3
        LENDING_POOL.withdraw(underlyingAsset, aTokenAmount, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            IERC20 tokenIn = _decodeTokenIn(collateral.swapParams.path);
            IERC20 tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(aTokenAmount);
                ConvertModule.USDS.safeIncreaseAllowance(comet, aTokenAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, aTokenAmount);
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: collateral.swapParams.path,
                        recipient: address(this),
                        amountIn: aTokenAmount,
                        amountOutMinimum: collateral.swapParams.amountOutMinimum,
                        deadline: collateral.swapParams.deadline
                    })
                );

                if (tokenOut == ConvertModule.DAI && baseToken == ConvertModule.USDS) {
                    _convertDaiToUsds(amountOut);
                    ConvertModule.USDS.safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, ConvertModule.USDS, amountOut);
                } else {
                    tokenOut.safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, tokenOut, amountOut);
                }
            }
            // If no swap is required, supply the collateral directly to Comet
        } else if (underlyingAsset == ConvertModule.DAI && baseToken == ConvertModule.USDS) {
            _convertDaiToUsds(aTokenAmount);
            ConvertModule.USDS.safeIncreaseAllowance(comet, aTokenAmount);
            IComet(comet).supplyTo(user, ConvertModule.USDS, aTokenAmount);
        } else {
            underlyingAsset.safeIncreaseAllowance(comet, aTokenAmount);
            IComet(comet).supplyTo(user, underlyingAsset, aTokenAmount);
        }
    }

    /**
     * @notice Checks whether the user's debt position for a specific asset in Aave V3 is fully repaid.
     *
     * @dev Queries the Aave V3 Data Provider to retrieve the user's reserve data for the given asset.
     *      The method extracts the current variable debt value and returns true only if it is zero.
     *
     * @param user The address of the user whose debt status is being checked.
     * @param asset The address of the underlying asset in Aave V3 (e.g., DAI, USDC, etc.).
     *
     * @return isCleared A boolean value indicating whether the variable debt for the given asset is zero.
     *         Returns `true` if fully repaid, `false` otherwise.
     */
    function _isDebtCleared(address user, IERC20 asset) internal view returns (bool isCleared) {
        // Get the user's current debt balance for the specified asset
        (, , uint256 currentVariableDebt, , , , , , ) = DATA_PROVIDER.getUserReserveData(asset, user);
        // Debt is cleared if the debt balance is zero
        isCleared = (currentVariableDebt == 0);
    }
}
