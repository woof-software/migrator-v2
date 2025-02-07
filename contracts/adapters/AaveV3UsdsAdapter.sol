// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IAavePool} from "../interfaces/aave/IAavePool.sol";
import {IAavePoolDataProvider} from "../interfaces/aave/IAavePoolDataProvider.sol";
import {IADebtToken} from "../interfaces/aave/IADebtToken.sol";
import {IAToken} from "../interfaces/aave/IAToken.sol";
import {IComet} from "../interfaces/IComet.sol";
import {ISwapRouter} from "../interfaces/@uniswap/v3-periphery/ISwapRouter.sol";
import {SwapModule} from "../modules/SwapModule.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {ConvertModule} from "../modules/ConvertModule.sol";

/// @title AaveV3UsdsAdapter
/// @notice Adapter contract to migrate positions from Aave V3 to Compound III (Comet)
contract AaveV3UsdsAdapter is IProtocolAdapter, SwapModule, ConvertModule {
    /// --------Custom Types-------- ///

    /**
     * @notice Initializes the AaveV3Adapter contract
     * @param uniswapRouter Address of the Uniswap V3 SwapRouter contract
     * @param daiUsdsConverter Address of the DAI to USDS converter contract
     * @param dai Address of the DAI token
     * @param usds Address of the USDS token
     * @param wrappedNativeToken Address of the wrapped native token (e.g., WETH)
     * @param aaveLendingPool Address of the Aave V3 Lending Pool contract
     * @param aaveDataProvider Address of the Aave V3 Data Provider contract
     * @param isFullMigration Boolean indicating whether the migration is a full migration
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
     * @dev aDebtToken Address of the Aave V3 variable debt token
     * @dev amount Amount of debt to repay; use `type(uint256).max` to repay all
     */
    struct AaveV3Borrow {
        address aDebtToken;
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

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @notice Address of the wrapped native token (e.g., WETH).
     */
    IWETH9 public immutable WRAPPED_NATIVE_TOKEN;

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
        if (deploymentParams.aaveLendingPool == address(0) || deploymentParams.wrappedNativeToken == address(0))
            revert InvalidZeroAddress();

        LENDING_POOL = IAavePool(deploymentParams.aaveLendingPool);
        DATA_PROVIDER = IAavePoolDataProvider(deploymentParams.aaveDataProvider);
        IS_FULL_MIGRATION = deploymentParams.isFullMigration;
        WRAPPED_NATIVE_TOKEN = IWETH9(deploymentParams.wrappedNativeToken);
    }

    /// --------Functions-------- ///

    /**
     * @notice Executes the migration of a user's Aave V3 position to Compound III
     * @dev This function decodes the migration data and processes borrows and collateral
     * @param user Address of the user whose position is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param migrationData Encoded data containing the user's Aave V3 position details
     */
    function executeMigration(address user, address comet, bytes calldata migrationData) external override {
        // Decode the migration data into an AaveV3Position struct
        AaveV3Position memory position = abi.decode(migrationData, (AaveV3Position));

        // Repay each borrow position
        for (uint256 i = 0; i < position.borrows.length; i++) {
            repayBorrow(user, position.borrows[i]);
        }

        // Migrate each collateral position
        for (uint256 i = 0; i < position.collaterals.length; i++) {
            migrateCollateral(user, comet, position.collaterals[i]);
        }
    }

    /**
     * @notice Repays a borrow position for the user on Aave V3
     * @dev May perform a swap to obtain the necessary tokens for repayment
     * @param user Address of the user whose borrow is being repaid
     * @param borrow The borrow position details
     */
    function repayBorrow(address user, AaveV3Borrow memory borrow) internal {
        // Determine the amount to repay. If max value, repay the full debt balance
        uint256 repayAmount = borrow.amount == type(uint256).max
            ? IERC20(borrow.aDebtToken).balanceOf(user)
            : borrow.amount;

        // If a swap is required to obtain the repayment tokens
        if (borrow.swapParams.path.length > 0) {
            address tokenIn = _decodeTokenIn(borrow.swapParams.path);
            address tokenOut = _decodeTokenOut(borrow.swapParams.path);
            // If the swap is from USDS to DAI, convert USDS to DAI
            if (tokenIn == ConvertModule.USDS && tokenOut == ConvertModule.DAI) {
                // Convert USDS to DAI for repayment
                _convertUsdsToDai(repayAmount);
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
        address underlyingAsset = IADebtToken(borrow.aDebtToken).UNDERLYING_ASSET_ADDRESS();

        // Approve the Aave Lending Pool to spend the repayment amount
        IADebtToken(underlyingAsset).approve(address(LENDING_POOL), repayAmount);
        // IADebtToken(underlyingAsset).approve(address(LENDING_POOL), type(uint256).max);

        // Repay the borrow on behalf of the user
        LENDING_POOL.repay(underlyingAsset, repayAmount, INTEREST_RATE_MODE, user);

        // Check if the debt for the collateral token has been successfully cleared
        if (IS_FULL_MIGRATION && !_isDebtCleared(user, underlyingAsset)) revert DebtNotCleared(borrow.aDebtToken);
    }

    /**
     * @notice Migrates a user's collateral position from Aave V3 to Compound III
     * @dev May perform a swap to obtain the migration tokens
     * @param user Address of the user whose collateral is being migrated
     * @param comet Address of the Compound III (Comet) contract
     * @param collateral The collateral position details
     */
    function migrateCollateral(address user, address comet, AaveV3Collateral memory collateral) internal {
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
            address tokenIn = _decodeTokenIn(collateral.swapParams.path);
            address tokenOut = _decodeTokenOut(collateral.swapParams.path);
            // If the swap is from DAI to USDS, convert DAI to USDS
            if (tokenIn == ConvertModule.DAI && tokenOut == ConvertModule.USDS) {
                _convertDaiToUsds(aTokenAmount);
                IERC20(ConvertModule.USDS).approve(comet, aTokenAmount);
                IComet(comet).supplyTo(user, ConvertModule.USDS, aTokenAmount);
                return;
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
                IERC20(tokenOut).approve(comet, amountOut);

                IComet(comet).supplyTo(user, tokenOut, amountOut);
                return;
            }
            // If the collateral token is the native token, wrap the native token and supply it to Comet
        } else if (underlyingAsset == NATIVE_TOKEN) {
            // Wrap the native token
            WRAPPED_NATIVE_TOKEN.deposit{value: aTokenAmount}();
            // Approve the wrapped native token to be spent by Comet
            WRAPPED_NATIVE_TOKEN.approve(comet, aTokenAmount);
            IComet(comet).supplyTo(user, address(WRAPPED_NATIVE_TOKEN), aTokenAmount);
            return;
            // If no swap is required, supply the collateral directly to Comet
        } else {
            IERC20(underlyingAsset).approve(comet, aTokenAmount);
            IComet(comet).supplyTo(user, underlyingAsset, aTokenAmount);
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
