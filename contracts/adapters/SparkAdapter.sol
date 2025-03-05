// SPDX-License-Identifier: MIT
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
import {IWETH9} from "../interfaces/IWETH9.sol";
import {DelegateReentrancyGuard} from "../utils/DelegateReentrancyGuard.sol";

/// @title SparkAdapter
/// @notice Adapter contract to migrate positions from Spark to Compound III (Comet)
contract SparkAdapter is IProtocolAdapter, SwapModule, DelegateReentrancyGuard {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;

    /// --------Custom Types-------- ///

    /**
     * @notice Structure representing the deployment parameters for the SparkAdapter contract
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param daiUsdsConverter Address of the DAI to USDS converter contract
     * @param dai Address of the DAI token
     * @param usds Address of the USDS token
     * @param wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * @param sparkLendingPool Address of the Spark Lending Pool contract
     * @param sparkDataProvider Address of the Spark Data Provider contract
     * @param isFullMigration Boolean indicating whether the migration is full or partial
     */
    struct DeploymentParams {
        address uniswapRouter;
        address wrappedNativeToken;
        address sparkLendingPool;
        address sparkDataProvider;
        bool isFullMigration;
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

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @notice Address of the wrapped native token (e.g., WETH).
     */
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

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
     * - wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * - sparkLendingPool Address of the Spark Lending Pool contract
     * - sparkDataProvider Address of the Spark Data Provider contract
     * - isFullMigration Boolean indicating whether the migration is full or partial
     * @dev Reverts if any of the provided addresses are zero
     */
    constructor(DeploymentParams memory deploymentParams) SwapModule(deploymentParams.uniswapRouter) {
        if (deploymentParams.sparkLendingPool == address(0) || deploymentParams.wrappedNativeToken == address(0))
            revert InvalidZeroAddress();

        LENDING_POOL = ISparkPool(deploymentParams.sparkLendingPool);
        DATA_PROVIDER = ISparkPoolDataProvider(deploymentParams.sparkDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
        WRAPPED_NATIVE_TOKEN = IWETH9(deploymentParams.wrappedNativeToken);
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's Spark position to Compound III
     * @dev This function decodes the migration data and processes borrows and collateral
     * @param user Address of the user whose position is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param migrationData Encoded data containing the user's Spark position details
     */
    function executeMigration(address user, address comet, bytes calldata migrationData) external nonReentrant {
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
    }

    /**
     * @notice Repays a borrow position for the user on Spark
     * @dev May perform a swap to obtain the necessary tokens for repayment
     * @param user Address of the user whose borrow is being repaid
     * @param borrow The borrow position details
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
        address underlyingAsset = IDebtToken(borrow.debtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Spark Lending Pool to spend the repayment amount
        IERC20(underlyingAsset).safeIncreaseAllowance(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(user, underlyingAsset)) revert DebtNotCleared(borrow.debtToken);
    }

    /**
     * @notice Migrates a user's collateral position from Spark to Compound III
     * @dev May perform a swap to obtain the migration tokens
     * @param user Address of the user whose collateral is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param collateral The collateral position details
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
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);

            uint256 amountOut = _swapCollateralToCompoundToken(
                ISwapRouter.ExactInputParams({
                    path: collateral.swapParams.path,
                    recipient: address(this),
                    amountIn: spTokenAmount,
                    amountOutMinimum: collateral.swapParams.amountOutMinimum,
                    deadline: block.timestamp
                })
            );
            IERC20(tokenOut).safeIncreaseAllowance(comet, amountOut);
            IComet(comet).supplyTo(user, tokenOut, amountOut);

            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (underlyingAsset == NATIVE_TOKEN) {
            // Wrap the native token
            WRAPPED_NATIVE_TOKEN.deposit{value: spTokenAmount}();
            // Approve the wrapped native token to be spent by Comet
            WRAPPED_NATIVE_TOKEN.approve(comet, spTokenAmount);
            IComet(comet).supplyTo(user, address(WRAPPED_NATIVE_TOKEN), spTokenAmount);

            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(underlyingAsset).safeIncreaseAllowance(comet, spTokenAmount);
            IComet(comet).supplyTo(user, underlyingAsset, spTokenAmount);
        }
    }

    /**
     * @notice Checks if the debt for a specific token has been successfully closed.
     * @param user Address of the user.
     * @param asset Address of the token for which the debt needs to be verified.
     * @return isCleared Boolean indicating whether the debt is cleared.
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
