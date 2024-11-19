// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IUniswapV3FlashCallback} from "./vendor/@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./vendor/@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IERC20} from "./vendor/@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Comet} from "./interfaces/CometInterface.sol";
import {CTokenLike} from "./interfaces/CTokenInterface.sol";
import {ATokenLike} from "./interfaces/AaveInterface.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

/**
 * @title CometMigratorV3
 * @notice Simplified version of the Comet Migrator for managing migrations to Compound III.
 */
contract CometMigratorV3 is IUniswapV3FlashCallback {
    // @TODO: Add custom types
    /// @notice Represents the configuration for executing a Uniswap swap.
    struct Swap {
        bytes path; // empty path if no swap is required (e.g. repaying USDC borrow)
        uint256 amountInMaximum; // Note: Can be set as `type(uint256).max`
    }

    /// @notice Represents an entire Compound II position (collateral + borrows) to migrate.
    struct CompoundV2Position {
        CompoundV2Collateral[] collateral;
        CompoundV2Borrow[] borrows;
        Swap[] swaps;
    }

    /// @notice Represents a given amount of Compound II collateral to migrate.
    struct CompoundV2Collateral {
        CTokenLike cToken;
        uint256 amount; // Note: This is the amount of the cToken
    }

    /// @notice Represents a given amount of Compound II borrow to migrate.
    struct CompoundV2Borrow {
        CTokenLike cToken;
        uint256 amount; // Note: This is the amount of the underlying asset, not the cToken
    }

    /// @notice Represents an entire Aave V3 position (collateral + borrows) to migrate.
    struct AaveV3Position {
        AaveV3Collateral[] collateral;
        AaveV3Borrow[] borrows;
        Swap[] swaps;
    }

    /// @notice Represents a given amount of Aave V3 collateral to migrate.
    struct AaveV3Collateral {
        ATokenLike aToken;
        uint256 amount;
    }

    /// @notice Represents a given amount of Aave V3 borrow to migrate.
    struct AaveV3Borrow {
        address debtToken; // Address of the StableDebtToken or VariableDebtToken
        uint256 amount;
        bool isStableRate; // true for stable rate, false for variable rate
    }

    /// @notice Represents all data required to continue operation after a flash loan is initiated.
    struct MigrationCallbackData {
        address user;
        uint256 flashAmount;
        CompoundV2Position compoundV2Position;
        AaveV3Position aaveV3Position;
    }
    
    /// @notice Key contract addresses used in migration.
    Comet public immutable COMET;

    /// @notice WETH token contract.
    IWETH9 public immutable WETH;

    /// @notice Uniswap liquidity pool for flash loans.
    IUniswapV3Pool public immutable UNISWAP_LIQUIDITY_POOL;

    /// @notice True if borrow token is token 0 in the Uniswap liquidity pool.
    bool public immutable IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0;

    /// @notice Address to receive any excess tokens after migration.
    address payable public immutable SWEEPEE;

    /// @notice Reentrancy guard.
    uint256 private inMigration;

    /// Events
    // @TODO: Add events

    /// Errors
    error InvalidConfiguration(uint256 loc);
    // @TODO: Add more errors

    /**
     * @notice Contract constructor.
     * @param comet_ The Compound III contract.
     * @param weth_ The WETH token contract.
     * @param uniswapLiquidityPool_ The Uniswap liquidity pool for flash loans.
     * @param sweepee_ Address to sweep excess tokens to.
     */
    constructor(
        Comet comet_,
        IWETH9 weth_,
        IUniswapV3Pool uniswapLiquidityPool_,
        address payable sweepee_ // and other parameters
    ) {
        COMET = comet_;
        WETH = weth_;
        UNISWAP_LIQUIDITY_POOL= uniswapLiquidityPool_;
        SWEEPEE = sweepee_;

        // Determine token position in the Uniswap pool.
        IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0 = uniswapLiquidityPool_.token0() == address(COMET.baseToken());
        if (
            !IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0 &&
            uniswapLiquidityPool_.token1() != address(COMET.baseToken())
        ) {
            revert InvalidConfiguration(0);
        }
    }

    /**
     * @notice Initiates a migration process.
     * @param flashAmount Amount of tokens to borrow via flash loan.
     */
    function migrate(uint256 flashAmount) external {
        // Simplified placeholder function.
    }

    /**
     * @notice Callback for Uniswap V3 flash loan.
     * @param fee0 Fee for borrowing token0.
     * @param fee1 Fee for borrowing token1.
     * @param data Encoded callback data.
     */
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {
        // Simplified placeholder function.
    }

    /**
     * @notice Sweeps any remaining tokens in the contract to the `sweepee` address.
     * @param token The token to sweep.
     */
    function sweep(IERC20 token) external {
        // Simplified placeholder function.
    }

    receive() external payable {
        // Allows the contract to receive ETH.
    }
}
