// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IAavePool} from "../interfaces/aave/IAavePool.sol";
import {IAavePoolDataProvider} from "../interfaces/aave/IAavePoolDataProvider.sol";
import {IWrappedTokenGatewayV3} from "../interfaces/aave/IWrappedTokenGatewayV3.sol";
import {IDebtToken} from "../interfaces/aave/IDebtToken.sol";
import {IAToken} from "../interfaces/aave/IAToken.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";
import {DelegateReentrancyGuard} from "../utils/DelegateReentrancyGuard.sol";

/**
 * @title AaveV3UsdsAdapter
 * @notice Adapter contract for migrating user positions from Aave V3 into Compound III (Comet),
 *         with native support for USDS markets and stablecoin conversion.
 *
 * @dev This contract implements the `IProtocolAdapter` interface and is designed to be used via
 *      delegatecall from the `MigratorV2` contract. It facilitates the seamless transfer of debt
 *      and collateral positions from Aave V3 to Compound III, with extended functionality to
 *      support USDS-based markets through the `ConvertModule`.
 *
 *      Core Responsibilities:
 *      - Decodes the user’s position (borrows and collaterals) from encoded calldata.
 *      - Handles repayment of variable-rate debt positions in Aave V3.
 *      - Executes token swaps (via Uniswap V3) or stablecoin conversions (DAI ⇄ USDS) as needed.
 *      - Withdraws and optionally converts Aave V3 collateral tokens before supplying them to Comet.
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
 *      - `_repayBorrow`: Repays Aave V3 debt, optionally converting tokens or swapping to the debt token.
 *      - `_migrateCollateral`: Withdraws and optionally converts Aave collateral into Comet-compatible tokens.
 *      - `_repayFlashloan`: Repays flash loans using the contract’s balance or by pulling from the user’s Comet account.
 *      - `_isDebtCleared`: Checks whether a specific Aave debt position has been fully repaid (for full migrations).
 *
 *      Swap & Conversion Support:
 *      - Integrates `SwapModule` for Uniswap V3 exact input/output swaps.
 *      - Integrates `ConvertModule` for DAI ⇄ USDS conversions.
 *      - Automatically chooses between swap and conversion logic based on token path and base token.
 *
 *      Constructor Configuration:
 *      - Accepts Uniswap router, stablecoin converter, token addresses, Aave contracts, and a full migration flag.
 *      - Stores all parameters as immutable for gas efficiency and safety.
 *
 *      Reentrancy:
 *      - All external entry points are guarded by `DelegateReentrancyGuard` to ensure secure delegatecall execution.
 *
 *      Requirements:
 *      - User must have approved this contract to move relevant aTokens and debtTokens.
 *      - Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
 *      - Swap parameters must be accurate and safe (especially for `amountInMaximum` and `amountOutMinimum`).
 *
 *      Limitations:
 *      - Supports only variable-rate Aave debt (interestRateMode = 2).
 *      - Only DAI ⇄ USDS conversions are supported (for USDS-based Comet markets).
 *      - Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`.
 */
contract AaveV3UsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule, DelegateReentrancyGuard {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Struct for initializing deployment parameters of the adapter.
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract.
     * @param daiUsdsConverter Address of the DAI-USDS converter contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     * @param wrappedNativeToken Address of the wrapped native token (e.g., WETH).
     * @param aaveLendingPool Address of the Aave V3 Lending Pool.
     * @param aaveDataProvider Address of the Aave V3 Data Provider.
     * @param isFullMigration Flag indicating whether the migration requires all debt to be cleared.
     */
    struct DeploymentParams {
        address uniswapRouter;
        address daiUsdsConverter;
        address dai;
        address usds;
        address wrappedNativeToken;
        address aaveLendingPool;
        address aaveDataProvider;
        bool isFullMigration;
    }

    /**
     * @notice Struct representing full user position in Aave V3.
     * @param borrows Borrow positions to be repaid.
     * @param collaterals Collateral positions to be withdrawn and migrated.
     */
    struct AaveV3Position {
        AaveV3Borrow[] borrows;
        AaveV3Collateral[] collaterals;
    }

    /**
     * @notice Struct representing a single borrow to repay.
     * @param debtToken Aave V3 debt token address.
     * @param amount Amount to repay (use type(uint256).max for full amount).
     * @param swapParams Parameters to obtain repay token (DAI/USDS).
     */
    struct AaveV3Borrow {
        address debtToken;
        uint256 amount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Struct representing a single collateral to migrate.
     * @param aToken Aave aToken address.
     * @param amount Amount to migrate (use type(uint256).max for full amount).
     * @param swapParams Parameters to convert to Compound-compatible token.
     */
    struct AaveV3Collateral {
        address aToken;
        uint256 amount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /// @notice Address of the native token (e.g., ETH)
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @notice Address of the wrapped native token (e.g., WETH).
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

    /// @notice Interest rate mode for variable-rate borrowings in Aave V3 (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;

    /// @notice Aave V3 Lending Pool contract address
    IAavePool public immutable LENDING_POOL;

    /// @notice Aave V3 Data Provider contract address
    IAavePoolDataProvider public immutable DATA_PROVIDER;

    /// --------Errors-------- ///

    /// @dev Reverts if the debt for a specific token has not been successfully cleared
    error DebtNotCleared(address aToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the AaveV3Adapter contract
     * @param deploymentParams Struct containing the deployment parameters:
     * - uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * - daiUsdsConverter Address of the DAI to USDS converter contract
     * - dai Address of the DAI token
     * - usds Address of the USDS token
     * - wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * - aaveLendingPool Address of the Aave V3 Lending Pool contract
     * - aaveDataProvider Address of the Aave V3 Data Provider contract
     * @dev Reverts if any of the provided addresses are zero
     */
    constructor(
        DeploymentParams memory deploymentParams
    )
        SwapModule(deploymentParams.uniswapRouter)
        ConvertModule(deploymentParams.daiUsdsConverter, deploymentParams.dai, deploymentParams.usds)
    {
        if (
            deploymentParams.aaveLendingPool == address(0) ||
            deploymentParams.wrappedNativeToken == address(0) ||
            deploymentParams.aaveDataProvider == address(0)
        ) revert InvalidZeroAddress();

        LENDING_POOL = IAavePool(deploymentParams.aaveLendingPool);
        DATA_PROVIDER = IAavePoolDataProvider(deploymentParams.aaveDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
        WRAPPED_NATIVE_TOKEN = IWETH9(deploymentParams.wrappedNativeToken);
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
     *     and supply it into the corresponding Compound III market. This may include wrapping native tokens,
     *     swaps via Uniswap V3, or DAI ⇄ USDS conversions.
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
     *
     * @dev This function is protected against reentrancy attacks.
     */
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData
    ) external nonReentrant {
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

        // Repay flashloan
        if (flashloanData.length > 0) {
            _repayFlashloan(user, comet, flashloanData);
        }
    }

    /**
     * @notice Repays a flash loan obtained from a Uniswap V3 liquidity pool.
     *
     * @dev This function ensures that the borrowed flash loan amount, including its associated fee,
     * is fully repaid to the original liquidity pool. If the contract's current balance in the
     * `flashBaseToken` is insufficient, it attempts to cover the shortfall by withdrawing tokens
     * from the user's Comet account. If the flash loan token is DAI while the Comet market uses
     * USDS as its base token, a conversion from USDS to DAI is performed before repayment.
     *
     * This logic supports both direct USDS usage and the proxy mechanism via DAI for markets
     * with USDS as the base asset.
     *
     * @param user The address of the user whose Comet balance may be used to cover the flash loan repayment.
     * @param comet The address of the Compound III (Comet) market where the user's collateral or base token is stored.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that issued the flash loan.
     *        - `flashBaseToken` (address): The token borrowed through the flash loan.
     *        - `flashAmountWithFee` (uint256): The total repayment amount, including the flash loan fee.
     *
     * Requirements:
     * - The contract must repay the flash loan in `flashBaseToken`, even if it must convert assets to obtain it.
     * - If conversion is required (USDS → DAI), it must happen before the repayment.
     * - If withdrawal is needed, the user must have sufficient available balance in the Comet market.
     *
     * Effects:
     * - May trigger a withdrawal from the user's Comet balance via `withdrawFrom()`.
     * - May invoke `_convertUsdsToDai()` to acquire the correct token for repayment.
     * - Concludes with a `safeTransfer` of `flashAmountWithFee` to the liquidity pool.
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
     * @notice Repays a user's borrow position on Aave V3 as part of the migration process.
     *
     * @dev This function determines the repayment amount (either specified or full),
     * optionally swaps tokens using Uniswap V3 or performs a DAI → USDS conversion,
     * then repays the user's debt position in Aave V3 using the lending pool.
     *
     * The borrow repayment is routed through the adapter, which may act on behalf of the user
     * using flash-loaned tokens or previously converted/supplied tokens.
     *
     * If the `isFullMigration` flag is true, the function checks whether the entire debt
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
     */
    function _repayBorrow(address user, AaveV3Borrow memory borrow) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.debtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(borrow.swapParams.path);
            address tokenOut = _decodeTokenOut(borrow.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                // Convert DAI to USDS and repay the borrow
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

        // Approve the Aave Lending Pool to spend the repayment amount
        IERC20(underlyingAsset).safeIncreaseAllowance(address(LENDING_POOL), repayAmount);

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
     *    - If the collateral is the native token, it wraps it to WETH and supplies it.
     *
     * Special handling:
     * - If the target Compound III market uses USDS and the user has DAI collateral,
     *   the contract automatically converts DAI to USDS.
     * - If `swapParams.path.length > 0`, it performs an on-chain token swap before depositing.
     * - If the token is ETH (represented as NATIVE_TOKEN), it wraps it to WETH.
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
        address underlyingAsset = IAToken(collateral.aToken).UNDERLYING_ASSET_ADDRESS();
        // Get the base token of the Comet contract
        address baseToken = IComet(comet).baseToken();
        // Withdraw the collateral from Aave V3
        LENDING_POOL.withdraw(underlyingAsset, aTokenAmount, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(collateral.swapParams.path);
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(aTokenAmount);
                IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, aTokenAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, aTokenAmount);
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: collateral.swapParams.path,
                        recipient: address(this),
                        amountIn: aTokenAmount,
                        amountOutMinimum: collateral.swapParams.amountOutMinimum,
                        deadline: block.timestamp
                    })
                );

                if (tokenOut == ConvertModule.DAI && baseToken == ConvertModule.USDS) {
                    _convertDaiToUsds(amountOut);
                    IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, ConvertModule.USDS, amountOut);
                } else {
                    IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);
                    IComet(comet).supplyTo(user, tokenOut, amountOut);
                }
            }
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (underlyingAsset == NATIVE_TOKEN) {
            // Wrap the native token
            WRAPPED_NATIVE_TOKEN.deposit{value: aTokenAmount}();
            // Approve the wrapped native token to be spent by Comet
            WRAPPED_NATIVE_TOKEN.approve(comet, aTokenAmount);
            IComet(comet).supplyTo(user, address(WRAPPED_NATIVE_TOKEN), aTokenAmount);
            // If no swap is required, supply the collateral directly to Comet
        } else if (underlyingAsset == ConvertModule.DAI && baseToken == ConvertModule.USDS) {
            _convertDaiToUsds(aTokenAmount);
            IERC20(ConvertModule.USDS).safeIncreaseAllowance(comet, aTokenAmount);
            IComet(comet).supplyTo(user, ConvertModule.USDS, aTokenAmount);
        } else {
            IERC20(underlyingAsset).safeIncreaseAllowance(comet, aTokenAmount);
            IComet(comet).supplyTo(user, underlyingAsset, aTokenAmount);
        }
    }

    /**
     * @notice Checks whether the user's debt position for a specific asset in Aave V3 is fully repaid.
     *
     * @dev Queries the Aave V3 Data Provider to retrieve the user's reserve data for the given asset.
     *      The method extracts the current stable and variable debt values and returns true
     *      only if both are equal to zero.
     *
     * @param user The address of the user whose debt status is being checked.
     * @param asset The address of the underlying asset in Aave V3 (e.g., DAI, USDC, etc.).
     *
     * @return isCleared A boolean value indicating whether the total debt (stable + variable)
     *         for the given asset is zero. Returns `true` if fully repaid, `false` otherwise.
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
