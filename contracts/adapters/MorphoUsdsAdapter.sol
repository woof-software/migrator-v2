// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "../interfaces/morpho/IMorpho.sol";
import {SharesMathLib} from "../libs/morpho/SharesMathLib.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {DelegateReentrancyGuard} from "../utils/DelegateReentrancyGuard.sol";

/**
 * @title MorphoUsdsAdapter
 * @notice Adapter contract for migrating user positions from Morpho into Compound III (Comet),
 *         with native support for USDS markets and stablecoin conversion.
 *
 * @dev This contract implements the `IProtocolAdapter` interface and is designed to be used via
 *      delegatecall from the `MigratorV2` contract. It facilitates the seamless transfer of debt
 *      and collateral positions from Morpho to Compound III, with extended functionality to
 *      support USDS-based markets through the `ConvertModule`.
 *
 *      Core Responsibilities:
 *      - Decodes the user’s position (borrows and collaterals) from encoded calldata.
 *      - Handles repayment of borrow positions in the Morpho protocol.
 *      - Executes token swaps (via Uniswap V3) or stablecoin conversions (DAI ⇄ USDS) as needed.
 *      - Withdraws and optionally converts Morpho collateral tokens before supplying them to Comet.
 *      - Automatically wraps native tokens (ETH → WETH) when required.
 *      - Supports Uniswap-based flash loan repayments, with fallback logic to pull funds from the user’s Comet balance.
 *
 *      USDS-Specific Logic:
 *      - Converts DAI to USDS when migrating to USDS-based Comet markets.
 *      - Converts USDS to DAI when repaying flash loans borrowed in DAI for USDS Comet markets.
 *      - Automatically detects when stablecoin conversion is required based on swap paths and base tokens.
 *
 *      Key Components:
 *      - `executeMigration`: Entry point called via delegatecall from `MigratorV2`. Coordinates full migration flow.
 *      - `repayBorrow`: Repays Morpho debt, optionally converting tokens or swapping to the debt token.
 *      - `migrateCollateral`: Withdraws and optionally converts Morpho collateral into Comet-compatible tokens.
 *      - `_repayFlashloan`: Repays flash loans using the contract’s balance or by pulling from the user’s Comet account.
 *      - `_isDebtCleared`: Checks whether a specific Morpho debt position has been fully repaid (for full migrations).
 *
 *      Swap & Conversion Support:
 *      - Integrates `SwapModule` for Uniswap V3 exact input/output swaps.
 *      - Integrates `ConvertModule` for DAI ⇄ USDS conversions.
 *      - Automatically chooses between swap and conversion logic based on token path and base token.
 *
 *      Constructor Configuration:
 *      - Accepts Uniswap router, stablecoin converter, token addresses, Morpho contracts, and a full migration flag.
 *      - Stores all parameters as immutable for gas efficiency and safety.
 *
 *      Reentrancy:
 *      - All external entry points are guarded by `DelegateReentrancyGuard` to ensure secure delegatecall execution.
 *
 *      Requirements:
 *      - User must have approved this contract to move relevant debt and collateral positions.
 *      - Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
 *      - Swap parameters must be accurate and safe (especially for `amountInMaximum` and `amountOutMinimum`).
 *
 *      Limitations:
 *      - Supports only full-asset Morpho market positions (debt + collateral).
 *      - Only DAI ⇄ USDS conversions are supported (for USDS-based Comet markets).
 *      - Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`.
 */
contract MorphoUsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule, DelegateReentrancyGuard {
    /// -------- Libraries -------- ///

    using SharesMathLib for uint256;
    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Struct for initializing deployment parameters of the Morpho adapter.
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract.
     * @param daiUsdsConverter Address of the DAI-USDS converter contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     * @param wrappedNativeToken Address of the wrapped native token (e.g., WETH).
     * @param morphoLendingPool Address of the Morpho Lending Pool contract.
     * @param isFullMigration Flag indicating whether the migration requires all debt to be cleared.
     */
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
     * @notice Struct representing full user position in Morpho protocol.
     * @param borrows List of borrow positions to repay.
     * @param collateral List of collateral positions to be withdrawn and migrated.
     */
    struct MorphoPosition {
        MorphoBorrow[] borrows;
        MorphoCollateral[] collateral;
    }

    /**
     * @notice Struct representing a single borrow position on Morpho.
     * @param marketId Identifier of the lending market (used for lookups).
     * @param assetsAmount Amount of debt to repay (use type(uint256).max for full amount).
     * @param swapParams Parameters for obtaining the correct token to repay the borrow (e.g., USDS → DAI).
     */
    struct MorphoBorrow {
        Id marketId;
        uint256 assetsAmount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Struct representing a single collateral position on Morpho.
     * @param marketId Identifier of the lending market (used for lookups).
     * @param assetsAmount Amount of collateral to migrate (use type(uint256).max for full amount).
     * @param swapParams Parameters to convert to Compound-compatible token.
     */
    struct MorphoCollateral {
        Id marketId;
        uint256 assetsAmount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /// @notice Address of the native token (e.g., ETH)
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @notice Address of the wrapped native token (e.g., WETH).
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;

    /// @notice Morpho Lending Pool contract address
    IMorpho public immutable LENDING_POOL;

    /// --------Errors-------- ///

    /// @dev Reverts if the debt for a specific token has not been successfully cleared
    error DebtNotCleared(address spToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the MorphoUsdsAdapter contract
     * @param deploymentParams Deployment parameters for the MorphoUsdsAdapter contract:
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
    {
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
     * @dev This function performs the following steps:
     *  1. Decodes the encoded `migrationData` into a `MorphoPosition` struct containing the user's
     *     borrow and collateral positions across one or more Morpho markets.
     *  2. Iterates through all borrow positions and calls `repayBorrow`, which handles repayment logic
     *     including optional swaps or stablecoin conversion.
     *  3. Iterates through all collateral positions and calls `migrateCollateral`, which handles withdrawal
     *     from Morpho and supply to Comet. The migration may involve native token wrapping, swaps via
     *     Uniswap V3, or DAI ⇄ USDS conversion.
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
     *
     * @dev This function is protected against reentrancy attacks.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData
    ) external nonReentrant {
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

        // Repay flashloan
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool during migration.
     *
     * @dev This function ensures that the borrowed amount, including the associated fee,
     * is repaid in full to the original `flashLiquidityPool`.
     *
     * Repayment logic:
     * - If the contract already holds enough `flashBaseToken`, the loan is repaid directly.
     * - If the balance is insufficient:
     *   - The function attempts to withdraw the shortfall from the user's Comet account.
     *   - If the Comet market base token is USDS and the flash loan token is DAI,
     *     it converts USDS to DAI before making the repayment.
     *
     * Supports proxy migration via DAI for USDS-based Comet markets.
     *
     * @param user The address of the user whose funds in Comet may be used for repayment.
     * @param comet The address of the Compound III (Comet) contract from which the shortfall may be withdrawn.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): Uniswap V3 pool that provided the flash loan.
     *        - `flashBaseToken` (address): Token used for the flash loan.
     *        - `flashAmountWithFee` (uint256): Total amount to repay, including fee.
     *
     * Requirements:
     * - Flash loan repayment must be fulfilled in `flashBaseToken`.
     * - The user must hold sufficient balance in Comet to cover shortfall if needed.
     * - Conversions (USDS → DAI) must succeed if required for repayment.
     *
     * Effects:
     * - May call `withdrawFrom()` on Comet.
     * - May call `_convertUsdsToDai()` internally.
     * - Completes repayment with `safeTransfer()` to `flashLiquidityPool`.
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
     * @notice Repays a borrow position for the user in the Morpho protocol.
     *
     * @dev This function performs the following steps:
     *  1. Retrieves market parameters and accrues interest for the specified market.
     *  2. If `assetsAmount` is `type(uint256).max`, it calculates the full debt in assets using the user's borrow shares.
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
    function repayBorrow(address user, MorphoBorrow memory borrow) internal {
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

        IERC20(marketParams.loanToken).safeIncreaseAllowance(address(LENDING_POOL), borrow.assetsAmount);

        LENDING_POOL.repay(marketParams, 0, position.borrowShares, user, new bytes(0));

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
     *  6. If no swap is needed:
     *     - Wraps the native token if `collateralAsset` is the native ETH.
     *     - Otherwise, supplies the token directly.
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
     * - May wrap native ETH and approve/supply to the Comet contract.
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
                IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, withdrawAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, withdrawAmount);
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

                if (tokenOut == ConvertModule.DAI && IComet(comet).baseToken() == ConvertModule.USDS) {
                    _convertDaiToUsds(amountOut);
                    IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, ConvertModule.USDS, amountOut);
                } else {
                    IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, tokenOut, amountOut);
                }
            }
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (collateralAsset == NATIVE_TOKEN) {
            // Wrap the native token
            WRAPPED_NATIVE_TOKEN.deposit{value: withdrawAmount}();
            // Approve the wrapped native token to be spent by Comet
            WRAPPED_NATIVE_TOKEN.approve(comet, withdrawAmount);
            IComet(comet).supplyTo(user, address(WRAPPED_NATIVE_TOKEN), withdrawAmount);
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
