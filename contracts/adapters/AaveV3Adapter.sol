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

/**
 * @title AaveV3Adapter
 * @notice Adapter contract for migrating user positions from Aave V3 into Compound III (Comet).
 *
 * @dev This contract implements the `IProtocolAdapter` interface and serves as a migration adapter used
 *      by the `MigratorV2` contract. It orchestrates the process of repaying user debt and withdrawing
 *      collateral from Aave V3, and optionally performs swaps before supplying assets into Comet.
 *
 *      Core Responsibilities:
 *      - Decodes the user’s position (borrows and collaterals) from encoded calldata.
 *      - Handles repayment of variable-rate debt positions in Aave V3.
 *      - Performs exact-output swaps via Uniswap V3 to obtain tokens required for repayment or deposit.
 *      - Withdraws and optionally converts collateral tokens into a format accepted by Comet.
 *      - Optionally repays flash loans using contract balance or by withdrawing from user's Comet account.
 *
 *      Key Components:
 *      - `executeMigration`: Entry point invoked via delegatecall from `MigratorV2`, executing full migration flow.
 *      - `_repayBorrow`: Repays individual borrow positions from Aave V3, optionally swapping to the correct token.
 *      - `_migrateCollateral`: Withdraws collateral from Aave V3 and supplies it into Comet, optionally performing swaps.
 *      - `_repayFlashloan`: Repays Uniswap V3 flash loans used to bootstrap migration liquidity.
 *      - `_isDebtCleared`: Verifies debt repayment status post-migration (used in full migrations only).
 *
 *      Swap Support:
 *      - Leverages `SwapModule` to perform swaps through Uniswap V3.
 *      - Supports both `ExactInput` (for collateral) and `ExactOutput` (for borrow repayments).
 *      - Handles native asset wrapping (ETH → WETH) if needed for Comet compatibility.
 *
 *      Constructor Configuration:
 *      - Takes deployment parameters including router, Aave pool contracts, WETH, and migration mode flag.
 *      - Validates and stores immutables required for migration operations.
 *
 *      Reentrancy:
 *      - Protected with `DelegateReentrancyGuard` to prevent nested calls during delegatecall-based migration.
 *
 *      Requirements:
 *      - User must have granted this contract approval for all aTokens and debtTokens involved.
 *      - Underlying assets must be supported by Uniswap and Compound III.
 *      - Swap parameters must be properly constructed and safe for execution.
 *
 *      Limitations:
 *      - Supports only variable-rate debt (interestRateMode = 2).
 *      - Requires accurate swap paths and limits for safe execution.
 *      - Relies on delegatecall from `MigratorV2` to function correctly.
 */
contract AaveV3Adapter is IProtocolAdapter, SwapModule {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Initializes the AaveV3Adapter contract
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param aaveLendingPool Address of the Aave V3 Lending Pool contract
     * @param aaveDataProvider Address of the Aave V3 Data Provider contract
     * @param isFullMigration Boolean indicating whether the migration is a full migration
     */
    struct DeploymentParams {
        address uniswapRouter;
        address aaveLendingPool;
        address aaveDataProvider;
        bool isFullMigration;
    }

    /**
     * @notice Structure representing the user's position in Aave V3
     * @dev borrows Array of borrow positions to repay
     * @dev collateral Array of collateral positions to migrate
     */
    struct AaveV3Position {
        AaveV3Borrow[] borrows;
        AaveV3Collateral[] collaterals;
    }

    /**
     * @notice Structure representing an individual borrow position in Aave V3
     * @dev debtToken Address of the Aave V3 variable debt token
     * @dev amount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct AaveV3Borrow {
        address debtToken;
        uint256 amount;
        SwapInputLimitParams swapParams;
    }

    /**
     * @notice Structure representing an individual collateral position in Aave V3
     * @dev aToken Address of the Aave V3 aToken (collateral token)
     * @dev amount Amount of collateral to migrate; use `type(uint256).max` to migrate all
     */
    struct AaveV3Collateral {
        address aToken;
        uint256 amount;
        SwapOutputLimitParams swapParams;
    }

    /// --------Constants-------- ///

    /// @notice Interest rate mode for variable-rate borrowings in Aave V3 (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

    /// @notice Boolean indicating whether the migration is a full migration
    bool public immutable IS_FULL_MIGRATION;
    /**
     * @notice Aave V3 Lending Pool contract address
     */
    IAavePool public immutable LENDING_POOL;

    /**
     * @notice Aave V3 Data Provider contract address
     */
    IAavePoolDataProvider public immutable DATA_PROVIDER;

    /// --------Errors-------- ///

    /**
     * @dev Reverts if the debt for a specific token has not been successfully cleared
     */
    error DebtNotCleared(address aToken);

    /// --------Constructor-------- ///

    /**
     * @notice Initializes the AaveV3Adapter contract
     * @param deploymentParams Struct containing the deployment parameters:
     * - uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * - daiUsdsConverter Address of the DAI to USDS converter contract
     * - wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * - aaveLendingPool Address of the Aave V3 Lending Pool contract
     * - aaveDataProvider Address of the Aave V3 Data Provider contract
     * @dev Reverts if any of the provided addresses are zero
     */
    constructor(DeploymentParams memory deploymentParams) SwapModule(deploymentParams.uniswapRouter) {
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
     *     This may involve swaps via Uniswap V3.
     *  3. Iterates through each collateral item and calls `_migrateCollateral` to withdraw it from Aave V3
     *     and supply it into the corresponding Compound III market. This may include wrapping native tokens
     *     or swaps via Uniswap V3.
     *  4. If flash loan data is provided, it settles the flash loan debt via `_repayFlashloan`, either from
     *     the contract balance or by withdrawing from the user's Compound III account.
     *
     * @param user The address of the user whose Aave V3 position is being migrated.
     * @param comet The address of the target Compound III (Comet) contract to receive the migrated assets.
     * @param migrationData ABI-encoded `AaveV3Position` struct that contains:
     *        - An array of `AaveV3Borrow` items representing debts to repay.
     *        - An array of `AaveV3Collateral` items representing collaterals to migrate.
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
     * from the user's Comet account.
     *
     * This logic assumes that the borrowed token is directly usable for repayment and is supported
     * both by Uniswap V3 and the Compound III (Comet) market.
     *
     * @param user The address of the user whose Comet balance may be used to cover the flash loan repayment.
     * @param comet The address of the Compound III (Comet) market where the user's collateral or base token is stored.
     * @param flashloanData ABI-encoded tuple containing:
     *        - `flashLiquidityPool` (address): The Uniswap V3 pool that issued the flash loan.
     *        - `flashBaseToken` (address): The token borrowed through the flash loan.
     *        - `flashAmountWithFee` (uint256): The total repayment amount, including the flash loan fee.
     *
     * Requirements:
     * - The contract must repay the flash loan in `flashBaseToken`.
     * - If the contract does not have enough balance, it must withdraw the missing amount from the user’s Comet balance.
     * - The user must hold enough balance in Comet for this operation to succeed.
     *
     * Effects:
     * - May trigger a withdrawal from the user’s Comet balance via `withdrawFrom()`.
     * - Concludes with a `safeTransfer` of `flashAmountWithFee` to the liquidity pool.
     *
     * Reverts:
     * - If the repayment cannot be fulfilled due to insufficient balance or failed transfer.
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
     * @notice Repays a user's borrow position on Aave V3 as part of the migration process.
     *
     * @dev This function determines the repayment amount based on the provided `borrow.amount`.
     * If `amount == type(uint256).max`, it attempts to repay the full debt balance by checking
     * the user's current debt token balance.
     *
     * If the borrow includes swap parameters, the function performs a Uniswap V3 exact-output swap
     * to acquire the required amount of the repayment token. The swap path and `amountInMaximum`
     * must be properly configured in `borrow.swapParams`.
     *
     * Once the required token is acquired, the function fetches the underlying asset of the debt token,
     * approves the Aave V3 LendingPool to pull funds, and performs the repayment on behalf of the user.
     *
     * If `IS_FULL_MIGRATION` is enabled, the function verifies that the user's debt for the given asset
     * has been fully cleared by querying Aave’s DataProvider. It reverts with `DebtNotCleared` if any debt remains.
     *
     * @param user The address of the user whose Aave V3 borrow position is being repaid.
     * @param borrow Struct describing the debt position, including:
     *        - `debtToken`: Address of the Aave V3 variable debt token.
     *        - `amount`: Amount to repay (or `type(uint256).max` for full debt).
     *        - `swapParams`: Uniswap V3 swap path and limit parameters.
     *
     * Swap Logic:
     * - If `swapParams.path.length > 0`, the function performs an exact-output swap to obtain `debtToken`.
     *
     * Repayment:
     * - Extracts the underlying asset of `debtToken`.
     * - Approves `repayAmount` to the Aave LendingPool.
     * - Calls `repay()` with variable rate mode (2).
     *
     * Post-condition:
     * - If `IS_FULL_MIGRATION == true`, ensures the entire debt has been cleared, else reverts.
     *
     * Reverts:
     * - If swap fails or approval/reimbursement encounters an error.
     * - If residual debt exists after repayment during full migration.
     */
    function _repayBorrow(address user, AaveV3Borrow memory borrow) internal {
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
     * @dev This function transfers and unwraps collateral from Aave V3, optionally performs a swap
     * into a compatible token for Compound III, and deposits the result into the target market.
     *
     * Steps performed:
     * 1. Determines the amount of aToken to migrate. If `collateral.amount == type(uint256).max`,
     *    the user's full balance is used.
     * 2. Transfers the aTokens from the user to this adapter contract.
     * 3. Calls Aave’s `withdraw()` to redeem underlying tokens to this contract.
     * 4. Depending on the swap parameters:
     *    - If `swapParams.path.length > 0`, performs a Uniswap V3 swap.
     *    - If swap is from native token (`NATIVE_TOKEN`), wraps it to WETH.
     *    - If no swap is required, directly supplies to Compound III.
     *
     * Special handling:
     * - The function wraps native ETH into WETH before supplying if needed.
     * - Uses `safeIncreaseAllowance` before calling `supplyTo()` on the Comet contract.
     *
     * @param user The address of the user whose collateral is being migrated.
     * @param comet The address of the Compound III (Comet) market to receive the collateral.
     * @param collateral Struct describing the collateral to be migrated, including:
     *        - `aToken`: Aave aToken representing user's collateral.
     *        - `amount`: Amount of aToken to migrate, or `type(uint256).max` to migrate all.
     *        - `swapParams`: Optional Uniswap V3 swap parameters to convert collateral before deposit.
     *
     * Requirements:
     * - User must have approved this contract to transfer their aTokens.
     * - If swap is needed, the swap path must be correctly constructed.
     *
     * Reverts:
     * - If token transfer or swap fails.
     * - If Uniswap swap results in `amountOut < amountOutMinimum`.
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
        // Withdraw the collateral from Aave V3
        LENDING_POOL.withdraw(underlyingAsset, aTokenAmount, address(this));

        // If a swap is required to obtain the migration tokens
        if (collateral.swapParams.path.length > 0) {
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);

            uint256 amountOut = _swapCollateralToCompoundToken(
                ISwapRouter.ExactInputParams({
                    path: collateral.swapParams.path,
                    recipient: address(this),
                    amountIn: aTokenAmount,
                    amountOutMinimum: collateral.swapParams.amountOutMinimum,
                    deadline: block.timestamp
                })
            );
            IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);

            IComet(comet).supplyTo(user, tokenOut, amountOut);
            return;

            // If no swap is required, supply the collateral directly to Comet
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
