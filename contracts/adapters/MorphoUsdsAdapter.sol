// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "../interfaces/morpho/IMorpho.sol";
import {SharesMathLib} from "../libs/morpho/SharesMathLib.sol";

/**
 * @title MorphoUsdsAdapter
 * @notice Adapter contract for migrating user positions from Morpho to Compound III (Comet), with support for USDS-based markets.
 *
 * @dev This contract implements the `IProtocolAdapter` interface and integrates the `SwapModule` and `ConvertModule`
 *      to facilitate seamless migration of debt and collateral positions. It supports token swaps via Uniswap V3
 *      and stablecoin conversions (DAI ⇄ USDS) for USDS-based Compound III markets.
 *
 * Core Responsibilities:
 * - Decodes user positions (borrows and collaterals) from encoded calldata.
 * - Handles repayment of variable-rate debt positions in Morpho.
 * - Executes token swaps or stablecoin conversions as needed for repayment or migration.
 * - Withdraws and optionally converts Morpho collateral tokens before supplying them to Compound III.
 * - Supports Uniswap-based flash loan repayments with fallback logic to pull funds from the user's Comet balance.
 *
 * USDS-Specific Logic:
 * - Converts DAI to USDS when migrating to USDS-based Comet markets.
 * - Converts USDS to DAI when repaying flash loans borrowed in DAI for USDS Comet markets.
 * - Automatically detects when stablecoin conversion is required based on swap paths and base tokens.
 *
 * Key Components:
 * - `executeMigration`: Entry point for coordinating the full migration flow.
 * - `_repayBorrow`: Handles repayment of Morpho debt, optionally performing swaps or conversions.
 * - `_migrateCollateral`: Withdraws and optionally converts Morpho collateral into Comet-compatible tokens.
 * - `_repayFlashloan`: Repays flash loans using contract balance or by withdrawing from the user's Comet account.
 * - `_isDebtCleared`: Verifies whether a specific Morpho debt position has been fully repaid.
 *
 * Constructor Configuration:
 * - Accepts Uniswap router, stablecoin converter, token addresses, Morpho contracts, and a full migration flag.
 * - Stores all parameters as immutable for gas efficiency and safety.
 *
 * Requirements:
 * - User must approve this contract to transfer relevant collateral and debt positions.
 * - The user must grant permission to the Migrator contract to interact with their tokens in the target Compound III market:
 *   `IComet.allow(migratorV2.address, true)`.
 * - Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
 * - Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).
 * - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment.
 *
 * Limitations:
 * - Supports only variable-rate Morpho debt.
 * - Only DAI ⇄ USDS conversions are supported for USDS-based Comet markets.
 * - Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`.
 *
 * Warning:
 * - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts.
 */
contract MorphoUsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule {
    /// -------- Libraries -------- ///

    using SharesMathLib for uint256;
    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Struct for initializing deployment parameters of the Morpho adapter.
     *
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract.
     * @param daiUsdsConverter Address of the DAI ⇄ USDS converter contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     * @param morphoLendingPool Address of the Morpho Lending Pool contract.
     * @param isFullMigration Boolean flag indicating whether the migration requires all debt to be cleared.
     * @param useSwapRouter02 Boolean flag indicating whether to use Uniswap V3 SwapRouter02.
     *
     * @dev This struct encapsulates all the necessary parameters required to deploy the `MorphoUsdsAdapter` contract.
     *      It ensures that the adapter is properly configured with the required external contract addresses and settings.
     */
    struct DeploymentParams {
        address uniswapRouter;
        address daiUsdsConverter;
        address dai;
        address usds;
        address morphoLendingPool;
        bool isFullMigration;
        bool useSwapRouter02;
    }

    /**
     * @notice Struct representing a user's full position in the Morpho protocol.
     *
     * @param borrows An array of `MorphoBorrow` structs representing the user's borrow positions to be repaid.
     * @param collateral An array of `MorphoCollateral` structs representing the user's collateral positions to be migrated.
     *
     * @dev This struct encapsulates all the necessary information about a user's Morpho position,
     *      enabling seamless migration of both debt and collateral to Compound III (Comet).
     */ struct MorphoPosition {
        MorphoBorrow[] borrows;
        MorphoCollateral[] collateral;
    }

    /**
     * @notice Struct representing a single borrow position on Morpho.
     *
     * @param marketId Identifier of the lending market (used for lookups).
     * @param assetsAmount Amount of debt to repay (use `type(uint256).max` for the full amount).
     * @param swapParams Parameters for obtaining the correct token to repay the borrow, including:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `amountInMaximum`: The maximum amount of input tokens that can be spent during the swap.
     *        - `deadline`: The timestamp by which the swap must be completed.
     *
     * @dev This struct is used to define the details of a borrow position, including the market ID,
     *      the amount to repay, and optional swap parameters for acquiring the repayment token.
     */
    struct MorphoBorrow {
        Id marketId;
        uint256 assetsAmount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Struct representing a single collateral position on Morpho.
     *
     * @param marketId Identifier of the lending market (used for lookups).
     * @param assetsAmount Amount of collateral to migrate (use `type(uint256).max` for the full amount).
     * @param swapParams Parameters for converting the collateral into a Compound-compatible token, including:
     *        - `path`: The encoded swap path specifying the token swap sequence.
     *        - `amountOutMinimum`: The minimum amount of output tokens to be received.
     *        - `deadline`: The timestamp by which the swap must be completed.
     *
     * @dev This struct is used to define the details of a collateral position, including the market ID,
     *      the amount to migrate, and optional swap parameters for converting the collateral into a token
     *      compatible with the target Compound III market.
     */
    struct MorphoCollateral {
        Id marketId;
        uint256 assetsAmount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /**
     * @notice The fixed length of the token conversion path used for DAI ⇄ USDS conversions.
     *
     * @dev This constant is used to validate the swap path length when performing stablecoin conversions
     *      between DAI and USDS in USDS-based Compound III (Comet) markets. It ensures that the swap path
     *      adheres to the expected format for conversions.
     */
    uint8 private constant CONVERT_PATH_LENGTH = 40;

    /**
     * @notice Boolean indicating whether the migration is a full migration.
     *
     * @dev This immutable variable determines if the migration process requires all debt positions
     *      to be fully cleared. If set to `true`, the contract ensures that all outstanding debt
     *      is repaid during the migration process. It is initialized during the deployment of the
     *      `MorphoUsdsAdapter` contract.
     */
    bool public immutable IS_FULL_MIGRATION;

    /**
     * @notice Morpho Lending Pool contract address.
     *
     * @dev This immutable variable holds the address of the Morpho Lending Pool, which is used to perform
     *      operations such as withdrawing collateral, repaying debt, and fetching user positions. It is
     *      initialized during the deployment of the `MorphoUsdsAdapter` contract.
     */
    IMorpho public immutable LENDING_POOL;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the debt for a specific token has not been successfully cleared.
     * @param spToken The address of the token associated with the uncleared debt.
     *
     * @notice This error is triggered during a full migration when the user's debt for a specific asset
     *         in Morpho has not been fully repaid after the repayment process.
     */
    error DebtNotCleared(address spToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the MorphoUsdsAdapter contract with deployment parameters.
     *
     * @param deploymentParams Struct containing the following deployment parameters:
     *        - `uniswapRouter`: Address of the Uniswap V3 SwapRouter contract.
     *        - `daiUsdsConverter`: Address of the DAI ⇄ USDS converter contract (optional, can be zero address).
     *        - `dai`: Address of the DAI token (optional, can be zero address).
     *        - `usds`: Address of the USDS token (optional, can be zero address).
     *        - `morphoLendingPool`: Address of the Morpho Lending Pool contract.
     *        - `isFullMigration`: Boolean flag indicating whether the migration requires all debt to be cleared.
     *        - `useSwapRouter02`: Boolean flag indicating whether to use Uniswap V3 SwapRouter02.
     *
     * @dev The constructor initializes the `SwapModule` and `ConvertModule` with the provided Uniswap router
     *      and stablecoin converter addresses. It also validates that the Morpho Lending Pool address is non-zero.
     *      All parameters are stored as immutable for gas efficiency and safety.
     *
     * Requirements:
     * - `morphoLendingPool` must not be a zero address.
     *
     * Warning:
     * - If `daiUsdsConverter`, `dai`, or `usds` are set to zero addresses, USDS-specific logic (e.g., DAI ⇄ USDS conversions)
     *   will not be supported. In this case, only standard token swaps will be available for migration.
     *
     * Reverts:
     * - {InvalidZeroAddress} if `morphoLendingPool` is a zero address.
     */
    constructor(
        DeploymentParams memory deploymentParams
    )
        SwapModule(deploymentParams.uniswapRouter, deploymentParams.useSwapRouter02)
        ConvertModule(deploymentParams.daiUsdsConverter, deploymentParams.dai, deploymentParams.usds)
    {
        if (deploymentParams.morphoLendingPool == address(0)) revert InvalidZeroAddress();

        LENDING_POOL = IMorpho(deploymentParams.morphoLendingPool);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's full or partial position from Morpho to Compound III (Comet).
     *
     * @dev This function performs the following steps:
     *  1. Decodes the encoded `migrationData` into a `MorphoPosition` struct containing the user's
     *     borrow and collateral positions across one or more Morpho markets.
     *  2. Iterates through all borrow positions and calls `_repayBorrow`, which handles repayment logic
     *     including optional swaps or stablecoin conversion.
     *  3. Iterates through all collateral positions and calls `_migrateCollateral`, which handles withdrawal
     *     from Morpho and supply to Comet. The migration may involve swaps via Uniswap V3 or DAI ⇄ USDS conversion.
     *  4. If flash loan data is provided, settles the flash loan using `_repayFlashloan`, covering
     *     repayment either from contract balance or the user’s Comet account.
     *
     * @param user The address of the user whose Morpho position is being migrated.
     * @param comet The address of the target Compound III (Comet) contract that will receive the migrated assets.
     * @param migrationData ABI-encoded `MorphoPosition` struct that contains:
     *        - An array of `MorphoBorrow` entries representing debts to repay.
     *        - An array of `MorphoCollateral` entries representing collaterals to migrate.
     * @param flashloanData Optional ABI-encoded data used to repay a Uniswap V3 flash loan if used.
     *        Should be empty if no flash loan was taken (e.g., in pure collateral migration scenarios).
     * @param preBaseAssetBalance The contract's base token balance before the migration process begins.
     *
     * Requirements:
     * - The user must approve this contract to transfer their debt and collateral positions.
     * - The `migrationData` must be correctly encoded and represent valid Morpho positions.
     * - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment.
     *
     * Effects:
     * - Repays borrow positions in Morpho.
     * - Migrates collateral positions from Morpho to Compound III.
     * - Optionally repays flash loans if used during the migration process.
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

        // Repay the flash loan if it has been used
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData, preBaseAssetBalance);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool during the migration process.
     *
     * @dev This function ensures that the borrowed flash loan amount, including its associated fee,
     *      is fully repaid to the originating liquidity pool. If the contract's balance of the
     *      `flashBaseToken` is insufficient, it attempts to withdraw the shortfall from the user's
     *      Compound III (Comet) account. If the flash loan was taken in DAI but the Comet market uses
     *      USDS as its base token, the contract first withdraws USDS and converts it to DAI before repayment.
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
     * @param user The address of the user whose Compound III (Comet) balance may be used to cover the shortfall.
     * @param comet The address of the Compound III (Comet) market associated with the user's position.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that provided the flash loan.
     *        - `flashBaseToken` (IERC20): The token borrowed via the flash loan.
     *        - `flashAmountWithFee` (uint256): The total amount to repay, including fees.
     * @param preBaseAssetBalance The contract's base token balance before the flash loan was taken.
     *
     * Requirements:
     * - The contract must ensure full repayment of `flashAmountWithFee` in `flashBaseToken`.
     * - If the contract's balance is insufficient, it must withdraw the difference from the user's Comet account.
     * - If the repayment token is DAI and the market uses USDS, conversion must occur prior to transfer.
     *
     * Effects:
     * - May withdraw assets from the user’s Compound III account using `withdrawFrom()`.
     * - May trigger `_convertUsdsToDai()` if conversion is necessary.
     * - Completes repayment with `safeTransfer()` to the liquidity pool.
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
     * @notice Repays a borrow position for the user in the Morpho protocol.
     *
     * @dev This function performs the following steps:
     *  1. Retrieves market parameters and accrues interest for the specified market.
     *  2. If `assetsAmount` is `type(uint256).max`, calculates the full debt in assets using the user's borrow shares.
     *  3. If a swap is required (as defined in `swapParams.path`), it either:
     *     - Converts USDS to DAI if needed, or
     *     - Executes a Uniswap V3 swap to acquire the borrow token.
     *  4. Increases allowance for the `loanToken` to the Morpho lending pool.
     *  5. Executes the repayment by calling `repay()` on the Morpho pool using the user's borrow shares.
     *  6. If `IS_FULL_MIGRATION` is enabled, verifies that the user has no remaining debt after repayment.
     *
     * @param user The address of the user whose borrow position is being repaid.
     * @param borrow Struct containing:
     *        - `marketId`: The ID of the Morpho market.
     *        - `assetsAmount`: The amount of debt to repay (use `type(uint256).max` to repay all).
     *        - `swapParams`: Parameters for acquiring the repayment token via Uniswap V3 or USDS conversion.
     *
     * Requirements:
     * - User must have an active borrow position in the specified market.
     * - If swapping is required, sufficient token balances must be available or convertible.
     * - Repayment must fully clear the debt if `IS_FULL_MIGRATION` is enabled.
     *
     * Effects:
     * - May trigger interest accrual.
     * - May perform a Uniswap V3 swap or USDS → DAI conversion.
     * - May revert with `DebtNotCleared` if full migration check fails.
     */
    function _repayBorrow(address user, MorphoBorrow memory borrow) internal {
        MarketParams memory marketParams = LENDING_POOL.idToMarketParams(borrow.marketId);

        LENDING_POOL.accrueInterest(marketParams); // call

        Position memory position = LENDING_POOL.position(borrow.marketId, user);
        bool usesShares = borrow.assetsAmount == type(uint256).max;

        // Determine the amount to repay. If max value, repay the full borrow balance
        if (usesShares) {
            Market memory market = LENDING_POOL.market(borrow.marketId);
            borrow.assetsAmount = uint256(position.borrowShares).toAssetsUp(
                market.totalBorrowAssets,
                market.totalBorrowShares
            );
        }

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            IERC20 tokenIn = _decodeTokenIn(borrow.swapParams.path);
            IERC20 tokenOut = _decodeTokenOut(borrow.swapParams.path);
            // If the swap is from USDS to DAI, convert USDS to DAI
            if (
                tokenIn == ConvertModule.USDS &&
                tokenOut == ConvertModule.DAI &&
                borrow.swapParams.path.length == CONVERT_PATH_LENGTH
            ) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(borrow.assetsAmount);
            } else if (
                tokenIn == ConvertModule.DAI &&
                tokenOut == ConvertModule.USDS &&
                borrow.swapParams.path.length == CONVERT_PATH_LENGTH
            ) {
                // Convert DAI to USDS for repayment
                _convertDaiToUsds(borrow.assetsAmount);
            } else {
                // Perform a swap to obtain the borrow token using the provided swap parameters
                _swapFlashloanToBorrowToken(
                    ISwapRouter.ExactOutputParams({
                        path: borrow.swapParams.path,
                        recipient: address(this),
                        amountOut: borrow.assetsAmount,
                        amountInMaximum: borrow.swapParams.amountInMaximum,
                        deadline: borrow.swapParams.deadline
                    }),
                    user
                );
            }
        }

        IERC20(marketParams.loanToken).safeIncreaseAllowance(address(LENDING_POOL), borrow.assetsAmount);

        LENDING_POOL.repay(
            marketParams,
            usesShares ? 0 : borrow.assetsAmount,
            usesShares ? position.borrowShares : 0,
            user,
            new bytes(0)
        );
        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(borrow.marketId, user)) revert DebtNotCleared(marketParams.loanToken);
    }

    /**
     * @notice Migrates a user's collateral position from Morpho to Compound III (Comet).
     *
     * @dev This function performs the following steps:
     *  1. Retrieves the user's position and market parameters from the Morpho protocol.
     *  2. Determines the amount of collateral to migrate. If `assetsAmount` is set to `type(uint256).max`,
     *     it migrates the entire collateral balance.
     *  3. Calls `withdrawCollateral` to transfer the specified amount from the user to this contract.
     *  4. If a swap is required:
     *     - Converts DAI → USDS if applicable using `_convertDaiToUsds()`.
     *     - Otherwise, performs a Uniswap V3 swap defined by `swapParams`.
     *     - If the Comet base token is USDS but the output token is DAI, converts DAI → USDS.
     *  5. Supplies the resulting token (USDS, DAI, or other) to the Compound III market via `supplyTo()`.
     *  6. If no swap is needed, supplies the collateral directly to the Comet market.
     *
     * @param user The address of the user whose Morpho collateral is being migrated.
     * @param comet The address of the target Compound III (Comet) contract to receive the supplied asset.
     * @param collateral Struct containing:
     *        - `marketId`: The ID of the Morpho market from which to withdraw collateral.
     *        - `assetsAmount`: The amount to migrate (use `type(uint256).max` to migrate all).
     *        - `swapParams`: Parameters for performing optional swaps or conversions.
     *
     * Requirements:
     * - The user must have sufficient collateral in the specified Morpho market.
     * - If a swap or conversion is required, enough token liquidity must be available.
     *
     * Effects:
     * - May trigger withdrawals from Morpho.
     * - May invoke Uniswap V3 swaps or DAI → USDS conversions.
     * - Supplies the resulting token to the Compound III market.
     */
    function _migrateCollateral(address user, address comet, MorphoCollateral memory collateral) internal {
        MarketParams memory marketParams = LENDING_POOL.idToMarketParams(collateral.marketId);
        Position memory position = LENDING_POOL.position(collateral.marketId, user);

        // // Determine the amount of collateral to migrate. If max value, migrate the full collateral balance
        uint256 withdrawAmount = collateral.assetsAmount == type(uint256).max
            ? position.collateral
            : collateral.assetsAmount;

        // Get the underlying asset address of the collateral token
        IERC20 collateralAsset = IERC20(marketParams.collateralToken);

        // Withdraw the collateral from Morpho
        LENDING_POOL.withdrawCollateral(marketParams, withdrawAmount, user, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            IERC20 tokenIn = _decodeTokenIn(collateral.swapParams.path);
            IERC20 tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(withdrawAmount);
                ConvertModule.USDS.safeIncreaseAllowance(comet, withdrawAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, withdrawAmount);
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: collateral.swapParams.path,
                        recipient: address(this),
                        amountIn: withdrawAmount,
                        amountOutMinimum: collateral.swapParams.amountOutMinimum,
                        deadline: collateral.swapParams.deadline
                    })
                );

                if (tokenOut == ConvertModule.DAI && IComet(comet).baseToken() == ConvertModule.USDS) {
                    _convertDaiToUsds(amountOut);
                    ConvertModule.USDS.safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, ConvertModule.USDS, amountOut);
                } else {
                    tokenOut.safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, tokenOut, amountOut);
                }
            }
            // If no swap is required, supply the collateral directly to Comet
        } else {
            collateralAsset.safeIncreaseAllowance(comet, withdrawAmount);
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
        // Debt is cleared if the debt balance is zero
        isCleared = (position.borrowShares == 0);
    }
}
