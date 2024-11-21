// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IUniswapV3FlashCallback} from "./interfaces/@uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./interfaces/@uniswap/v3-core/IUniswapV3Pool.sol";
import {IComet} from "./interfaces/IComet.sol";

/**
 * @title MigratorV2
 * @notice This contract facilitates migration of user positions between protocols using flash loans from Uniswap V3.
 * @dev The contract interacts with Uniswap V3 for flash loans and uses protocol adapters to execute migrations.
 */
contract MigratorV2 is IUniswapV3FlashCallback, ReentrancyGuard {
    /// --------Custom Types-------- ///

    /**
     * @dev Struct to hold flash loan configuration details.
     * @param liquidityPool Address of the Uniswap V3 pool used for the flash loan.
     * @param baseToken Address of the token involved in the flash loan.
     * @param isToken0 Indicates whether the base token is token0 in the liquidity pool.
     * @param amount Amount of tokens to borrow in the flash loan.
     */
    struct FlashData {
        address liquidityPool;
        address baseToken;
        bool isToken0;
        uint256 amount;
    }

    /// --------Errors-------- ///

    /**
     * @dev Reverts if any address parameter is zero.
     */
    error InvalidZeroAddress();

    /**
     * @dev Reverts if migration data is empty.
     */
    error InvalidMigrationData();

    /**
     * @dev Reverts if the flash loan amount is zero.
     */
    error InvalidFlashAmount();

    /**
     * @dev Reverts if the caller is not the expected Uniswap pool.
     * @param sender Address of the unexpected sender.
     */
    error SenderNotUniswapPool(address sender);

    /// --------Events-------- ///

    /**
     * @notice Emitted when an adapter executes a migration.
     * @param adapter Address of the protocol adapter used for migration.
     * @param user Address of the user initiating the migration.
     * @param flashAmount Amount borrowed in the flash loan.
     * @param flashAmountWithFee Total amount repaid to the Uniswap pool (borrowed amount + fee).
     */
    event AdapterExecuted(
        address indexed adapter,
        address indexed user,
        uint256 flashAmount,
        uint256 flashAmountWithFee
    );

    /**
     * @dev Contract constructor.
     * @notice Initializes the `ReentrancyGuard` to prevent reentrancy attacks.
     */
    constructor() ReentrancyGuard() {}

    /// --------Functions-------- ///

    /**
     * @notice Initiates a migration using a flash loan.
     * @param adapter Address of the protocol adapter responsible for the migration logic.
     * @param comet Address of the Comet contract used for fund management.
     * @param migrationData Encoded data containing migration-specific parameters.
     * @param flashData Struct containing configuration details for the flash loan.
     * @dev Performs necessary validations and invokes a flash loan from Uniswap V3.
     */
    function migrate(
        address adapter,
        address comet, //@TODO: Is this parameter needed here?
        bytes calldata migrationData,
        FlashData calldata flashData
    ) external nonReentrant {
        if (
            adapter == address(0) ||
            comet == address(0) ||
            flashData.liquidityPool == address(0) ||
            flashData.baseToken == address(0)
        ) revert InvalidZeroAddress();

        if (flashData.amount == 0) revert InvalidFlashAmount();
        if (migrationData.length == 0) revert InvalidMigrationData();

        bytes memory callbackData = abi.encode(
            msg.sender,
            adapter,
            comet,
            migrationData,
            flashData
        );

        IUniswapV3Pool(flashData.liquidityPool).flash(
            address(this),
            flashData.isToken0 ? flashData.amount : 0,
            flashData.isToken0 ? 0 : flashData.amount,
            callbackData
        );
    }

    /**
     * @notice Callback function triggered by Uniswap V3 after a flash loan is initiated.
     * @param fee0 Fee for borrowing token0.
     * @param fee1 Fee for borrowing token1.
     * @param data Encoded data passed during the flash loan initiation.
     * @dev Decodes the callback data, performs migration logic via the adapter, and repays the flash loan.
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        _uniswapV3FlashCallback(fee0, fee1, data);
    }

    /**
     * @notice Private implementation of the Uniswap V3 flash callback logic.
     * @param fee0 Fee for borrowing token0.
     * @param fee1 Fee for borrowing token1.
     * @param data Encoded data passed during the flash loan initiation.
     * @dev Ensures reentrancy protection and validates the flash loan repayment logic.
     */
    function _uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) private nonReentrant {
        (
            address user,
            address adapter,
            address comet,
            bytes memory migrationData,
            FlashData memory flashData
        ) = abi.decode(data, (address, address, address, bytes, FlashData));

        if (msg.sender != flashData.liquidityPool) revert SenderNotUniswapPool(msg.sender);

        uint256 flashAmountWithFee = flashData.amount + (flashData.isToken0 ? fee0 : fee1);

        IProtocolAdapter(adapter).executeMigration(user, migrationData);

        uint256 balance = IERC20(flashData.baseToken).balanceOf(address(this));
       
        if (balance < flashAmountWithFee) {
            IComet(comet).withdrawFrom(
                user,
                address(this),
                address(flashData.baseToken),
                flashAmountWithFee - balance
            );
        }

        IERC20(flashData.baseToken).transfer(msg.sender, flashAmountWithFee);

        emit AdapterExecuted(adapter, user, flashData.amount, flashAmountWithFee);
    }
}
