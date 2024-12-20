// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAdapter} from "./BaseAdapter.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {ISparkPool} from "./interfaces/spark/ISparkPool.sol";
import {ISparkPoolDataProvider} from "./interfaces/spark/ISparkPoolDataProvider.sol";
import {ISpDebtToken} from "./interfaces/spark/ISpDebtToken.sol";
import {ISpToken} from "./interfaces/spark/ISpToken.sol";
import {IComet} from "./interfaces/IComet.sol";
import {ISwapRouter} from "./interfaces/@uniswap/v3-periphery/ISwapRouter.sol";

/// @title SparkAdapter
/// @notice Adapter contract to migrate positions from Spark to Compound III (Comet)
contract SparkAdapter is BaseAdapter, IProtocolAdapter {
    /// --------Custom Types-------- ///

    /**
     * @notice Structure representing the user's position in Spark
     * @dev borrows Array of borrow positions to repay
     * @dev collateral Array of collateral positions to migrate
     * @dev swaps Array of swap parameters corresponding to each borrow
     */
    struct SparkPosition {
        SparkBorrow[] borrows;
        SparkCollateral[] collateral;
        Swap[] swaps;
    }

    /**
     * @notice Structure representing an individual borrow position in Spark
     * @dev spDebtToken Address of the Spark variable debt token
     * @dev amount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct SparkBorrow {
        address spDebtToken;
        uint256 amount;
    }

    /**
     * @notice Structure representing an individual collateral position in Spark
     * @dev spToken Address of the Spark spToken (collateral token)
     * @dev amount Amount of collateral to migrate; use `type(uint256).max` to migrate all
     */
    struct SparkCollateral {
        address spToken;
        uint256 amount;
    }

    /// --------Constants-------- ///

    /// @notice Interest rate mode for variable-rate borrowings in Spark (2 represents variable rate)
    uint256 public constant INTEREST_RATE_MODE = 2;

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
     * @param _uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param _daiUsdsConverter Address of the DAI to USDS converter contract
     * @param _dai Address of the DAI token
     * @param _usds Address of the USDS token
     * @param _wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * @param _sparkLendingPool Address of the Spark Lending Pool contract
     */
    constructor(
        address _uniswapRouter,
        address _daiUsdsConverter,
        address _dai,
        address _usds,
        address _wrappedNativeToken,
        address _sparkLendingPool,
        address _sparkDataProvider
    ) BaseAdapter(_uniswapRouter, _daiUsdsConverter, _dai, _usds, _wrappedNativeToken) {
        if (_sparkLendingPool == address(0)) revert InvalidZeroAddress();
        LENDING_POOL = ISparkPool(_sparkLendingPool);
        DATA_PROVIDER = ISparkPoolDataProvider(_sparkDataProvider);
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's Spark position to Compound III
     * @dev This function decodes the migration data and processes borrows and collateral
     * @param user Address of the user whose position is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param migrationData Encoded data containing the user's Spark position details
     */
    function executeMigration(address user, address comet, bytes calldata migrationData) external override {
        // Decode the migration data into an SparkPosition struct
        SparkPosition memory position = abi.decode(migrationData, (SparkPosition));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            repayBorrow(user, position.borrows[i], position.swaps[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collateral.length; i++) {
            migrateCollateral(user, comet, position.collateral[i], position.swaps[i]);
        }
    }

    /**
     * @notice Repays a borrow position for the user on Spark
     * @dev May perform a swap to obtain the necessary tokens for repayment
     * @param user Address of the user whose borrow is being repaid
     * @param borrow The borrow position details
     * @param swap Swap parameters to obtain the repayment tokens, if needed
     */
    function repayBorrow(address user, SparkBorrow memory borrow, Swap memory swap) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.spDebtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (swap.pathOfSwapFlashloan.length > 0) {
            address tokenIn = _decodeTokenIn(swap.pathOfSwapFlashloan);
            address tokenOut = _decodeTokenOut(swap.pathOfSwapFlashloan);
            // If the swap is from USDS to DAI, convert USDS to DAI
            if (tokenIn == BaseAdapter.USDS && tokenOut == BaseAdapter.DAI) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(repayAmount);
            } else {
                // Perform a swap to obtain the borrow token using the provided swap parameters
                _swapFlashloanToBorrowToken(
                    ISwapRouter.ExactOutputParams({
                        path: swap.pathOfSwapFlashloan,
                        recipient: address(this),
                        amountOut: repayAmount,
                        amountInMaximum: swap.amountInMaximum,
                        deadline: block.timestamp
                    })
                );
            }
        }

        // Get the underlying asset address of the debt token
        address underlyingAsset = ISpDebtToken(borrow.spDebtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Spark Lending Pool to spend the repayment amount
        ISpDebtToken(underlyingAsset).approve(address(LENDING_POOL), repayAmount);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);
    }

    /**
     * @notice Migrates a user's collateral position from Spark to Compound III
     * @dev May perform a swap to obtain the migration tokens
     * @param user Address of the user whose collateral is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param collateral The collateral position details
     * @param swap Swap parameters to obtain the migration tokens, if needed
     */
    function migrateCollateral(
        address user,
        address comet,
        SparkCollateral memory collateral,
        Swap memory swap
    ) internal {
        // Check if the debt for the collateral token has been successfully cleared
        if (!_isDebtCleared(user, collateral.spToken)) revert DebtNotCleared(collateral.spToken);
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
        if (swap.pathSwapCollateral.length > 0) {
            address tokenIn = _decodeTokenIn(swap.pathSwapCollateral);
            address tokenOut = _decodeTokenOut(swap.pathSwapCollateral);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == BaseAdapter.DAI && tokenOut == BaseAdapter.USDS) {
                _convertDaiToUsds(spTokenAmount);
                IERC20(BaseAdapter.USDS).approve(comet, spTokenAmount);
                IComet(comet).supplyTo(user, BaseAdapter.USDS, spTokenAmount);
                return;
            } else {
                uint256 amountOut = _swapCollateralToCompoundToken(
                    ISwapRouter.ExactInputParams({
                        path: swap.pathSwapCollateral,
                        recipient: address(this),
                        amountIn: spTokenAmount,
                        amountOutMinimum: swap.amountOutMinimum,
                        deadline: block.timestamp
                    })
                );
                IERC20(tokenOut).approve(comet, amountOut);
                IComet(comet).supplyTo(user, tokenOut, amountOut);
                return;
            }
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (underlyingAsset == BaseAdapter.NATIVE_TOKEN) {
            uint256 wrappedAmount = _wrapNativeToken(spTokenAmount);
            BaseAdapter.WRAPPED_NATIVE_TOKEN.approve(comet, wrappedAmount);
            IComet(comet).supplyTo(user, address(BaseAdapter.WRAPPED_NATIVE_TOKEN), wrappedAmount);
            return;
            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(underlyingAsset).approve(comet, spTokenAmount);
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
