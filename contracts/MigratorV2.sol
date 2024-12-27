// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IUniswapV3FlashCallback} from "./interfaces/@uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./interfaces/@uniswap/v3-core/IUniswapV3Pool.sol";
import {IComet} from "./interfaces/IComet.sol";
import {IERC20NonStandard} from "./interfaces/IERC20NonStandard.sol";

/**
 * @title MigratorV2
 * @notice This contract facilitates migration of user positions between protocols using flash loans from Uniswap V3.
 * @dev The contract interacts with Uniswap V3 for flash loans and uses protocol adapters to execute migrations.
 */
contract MigratorV2 is IUniswapV3FlashCallback, Ownable, ReentrancyGuard, Pausable {
    /// --------Types-------- ///

    /**
     * @dev Struct to hold flash loan configuration details.
     * @param liquidityPool Address of the Uniswap V3 pool used for the flash loan.
     * @param baseToken Address of the token involved in the flash loan.
     * @param isToken0 Indicates whether the base token is token0 in the liquidity pool.
     */
    struct FlashData {
        address liquidityPool;
        address baseToken;
        bool isToken0;
    }

    /// --------State Variables-------- ///

    /**
     * @dev List of all registered protocol adapters.
     */
    address[] private _adapters;

    /**
     * @dev Mapping of supported Comet contracts to their respective flash loan configuration details.
     */
    mapping(address => FlashData) private _flashData;

    /**
     * @dev Mapping to track whether an address is a registered protocol adapter.
     */
    mapping(address => bool) public allowedAdapters;

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
     * @dev Reverts if the adapter is not allowed.
     */
    error InvalidAdapter();

    /**
     * @dev Reverts if the caller is not the expected Uniswap pool.
     * @param sender Address of the unexpected sender.
     */
    error SenderNotUniswapPool(address sender);

    /**
     * @dev Reverts if the provided Comet contract is not supported.
     * @param comet Address of the unsupported Comet contract.
     */
    error CometIsNotSupported(address comet);

    /**
     * @dev Reverts if the ERC-20 transfer fails.
     */
    error ERC20TransferFailure();

    /**
     * @dev Reverts if the length of the provided arrays do not match.
     */
    error MismatchedArrayLengths();

    /**
     * @dev Reverts if the adapter is already allowed.
     * @param adapter Address of the adapter that is already allowed.
     */
    error AdapterAlreadyAllowed(address adapter);

    /**
     * @dev Reverts if the Comet contract is already configured.
     * @param comet Address of the Comet contract that is already configured.
     */
    error CometAlreadyConfigured(address comet);

    /// --------Events-------- ///

    /**
     * @notice Emitted when an adapter executes a migration.
     * @param adapter Address of the protocol adapter used for migration.
     * @param user Address of the user initiating the migration.
     * @param comet Address of the Comet contract associated with the migration.
     * @param flashAmount Amount borrowed in the flash loan.
     * @param flashFee Fee paid for the flash loan.
     */
    event MigrationExecuted(
        address indexed adapter,
        address indexed user,
        address indexed comet,
        uint256 flashAmount,
        uint256 flashFee
    );

    /**
     * @notice Emitted when a protocol adapter is registered.
     * @param adapter Address of the protocol adapter that was registered.
     */
    event AdapterAllowed(address indexed adapter);

    /**
     * @notice Emitted when a protocol adapter is removed.
     * @param adapter Address of the protocol adapter that was removed.
     */
    event AdapterRemoved(address indexed adapter);

    /**
     * @notice Emitted when flash loan data is configured for a Comet contract.
     * @param comet Address of the Comet contract.
     * @param liquidityPool Address of the Uniswap V3 pool used for the flash loan.
     * @param baseToken Address of the token involved in the flash loan.
     */
    event FlashDataConfigured(address indexed comet, address indexed liquidityPool, address indexed baseToken);

    /**
     * @notice Emitted when flash loan data is removed for a Comet contract.
     * @param comet Address of the Comet contract.
     */
    event FlashDataRemoved(address indexed comet);

    /// --------Modifiers-------- ///

    /**
     * @notice Ensures that the provided adapter address is valid.
     * @param adapter Address of the protocol adapter to validate.
     * @dev Reverts with {InvalidAdapter} if the adapter is not allowed.
     */
    modifier validAdapter(address adapter) {
        if (!allowedAdapters[adapter]) revert InvalidAdapter();
        _;
    }

    /**
     * @notice Ensures that the provided Comet address is supported.
     * @param comet Address of the Comet contract to validate.
     * @dev Reverts with {CometIsNotSupported} if the Comet contract is not supported.
     */
    modifier validComet(address comet) {
        if (_flashData[comet].liquidityPool == address(0)) revert CometIsNotSupported(comet);
        _;
    }

    /**
     * @notice Initializes the contract with the provided parameters.
     * @param multisig Address of the multisig wallet for contract ownership.
     * @param adapters (Optional) Array of protocol adapter addresses to register.
     * @param comets (Optional) Array of Comet contract addresses to support.
     * @param flashData (Optional) Array of flash loan configurations corresponding to each Comet contract.
     * @dev This constructor:
     *  - Sets the contract owner to the `multisig` address.
     *  - Registers protocol adapters provided in the `adapters` array.
     *  - Configures flash loan data for each corresponding Comet contract using the `flashData` array.
     *  - Pauses the contract if any of the input arrays are empty.
     * @dev Reverts with:
     *  - {InvalidZeroAddress} if any address within the inputs is zero.
     *  - {MismatchedArrayLengths} if the length of `comets` and `flashData` arrays do not match.
     */
    constructor(
        address multisig,
        address[] memory adapters,
        address[] memory comets,
        FlashData[] memory flashData
    ) Ownable(multisig) ReentrancyGuard() Pausable() {
        // Ensure `comets` and `flashData` arrays have matching lengths
        if (comets.length != flashData.length) revert MismatchedArrayLengths();

        // Register each adapter
        for (uint256 i = 0; i < adapters.length; i++) {
            _setAdapter(adapters[i]);
        }

        // Configure flash loan data for each corresponding Comet
        for (uint256 i = 0; i < flashData.length; i++) {
            _setFlashData(comets[i], flashData[i]);
        }
    }

    /// --------Functions-------- ///

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}

    /**
     * @notice Initiates the migration process using a flash loan from Uniswap V3.
     * @param adapter Address of the protocol adapter that handles the migration logic.
     * @param comet Address of the Comet contract associated with the migration.
     * @param migrationData Encoded data containing migration details, specific to the adapter.
     * @param flashAmount Amount of tokens to borrow in the flash loan.
     * @dev Validates the adapter and Comet contract, ensures the flash amount and migration data are valid.
     * @dev Encodes the migration data and initiates a flash loan from Uniswap V3.
     * @dev Reverts with {InvalidFlashAmount} if the flash loan amount is zero.
     * @dev Reverts with {InvalidMigrationData} if the migration data is empty.
     */
    function migrate(
        address adapter,
        address comet,
        bytes calldata migrationData,
        uint256 flashAmount
    ) external validAdapter(adapter) validComet(comet) {
        if (flashAmount == 0) revert InvalidFlashAmount();
        if (migrationData.length == 0) revert InvalidMigrationData();

        bytes memory callbackData = abi.encode(msg.sender, adapter, comet, migrationData, flashAmount);

        FlashData memory flashData = _flashData[comet];

        IUniswapV3Pool(flashData.liquidityPool).flash(
            address(this),
            flashData.isToken0 ? flashAmount : 0,
            flashData.isToken0 ? 0 : flashAmount,
            callbackData
        );
    }

    /**
     * @notice Callback function triggered by Uniswap V3 after a flash loan is initiated.
     * @param fee0 Fee for borrowing token0 in the flash loan.
     * @param fee1 Fee for borrowing token1 in the flash loan.
     * @param data Encoded data passed during the flash loan initiation, including migration details.
     * @dev Validates the caller and decodes the callback data.
     * @dev Invokes the adapter to execute the migration logic and ensures the flash loan is repaid.
     */
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external override {
        _uniswapV3FlashCallback(fee0, fee1, data);
    }

    /// --------Owner Functions-------- ///

    /**
     * @notice Registers a new protocol adapter.
     * @param adapter Address of the adapter to register.
     * @dev Ensures that the adapter address is valid and not already registered.
     * @dev Reverts with {InvalidZeroAddress} if the adapter address is zero.
     */
    function setAdapter(address adapter) external onlyOwner {
        _setAdapter(adapter);
    }

    /**
     * @notice Removes an existing protocol adapter.
     * @param adapter Address of the adapter to remove.
     * @dev Ensures that the adapter is currently registered before removal.
     */
    function removeAdapter(address adapter) external onlyOwner {
        _removeAdapter(adapter);
    }

    /**
     * @notice Sets flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract.
     * @param flashData Struct containing flash loan configuration details (liquidity pool, base token, token0 status).
     * @dev Validates the flashData parameters and updates the mapping.
     * @dev Reverts with {InvalidZeroAddress} if any address in the flashData is zero.
     */
    function setFlashData(address comet, FlashData memory flashData) external onlyOwner {
        _setFlashData(comet, flashData);
    }

    /**
     * @notice Removes flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract to remove flash data for.
     * @dev Ensures the Comet contract is currently supported before removal.
     */
    function removeFlashData(address comet) external onlyOwner {
        _removeFlashData(comet);
    }

    /**
     * @notice Pauses all migration operations.
     * @dev Can only be called by the contract owner.
     * @dev Emits a {Paused} event when successful.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes all migration operations after being paused.
     * @dev Can only be called by the contract owner.
     * @dev Emits an {Unpaused} event when successful.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /// --------View Functions-------- ///

    /**
     * @notice Retrieves the list of registered protocol adapters.
     * @return Array of all registered protocol adapter addresses.
     */

    function getAdapters() external view returns (address[] memory) {
        return _adapters;
    }

    /// --------Private Functions-------- ///

    /**
     * @notice Handles the logic executed during a Uniswap V3 flash loan callback.
     * @param fee0 Fee for borrowing token0 in the flash loan.
     * @param fee1 Fee for borrowing token1 in the flash loan.
     * @param data Encoded data containing migration details, user information, and flash loan specifics.
     * @dev Decodes the data passed in the flash loan, executes the migration using the protocol adapter,
     * validates the repayment of the flash loan with fees, and emits the {AdapterExecuted} event.
     * @dev Ensures reentrancy protection through the `nonReentrant` modifier.
     * @dev Reverts with {SenderNotUniswapPool} if the caller is not the expected Uniswap V3 liquidity pool.
     * @dev Reverts with {ERC20TransferFailure} if the token transfer to repay the flash loan fails.
     */
    function _uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) private nonReentrant {
        (address user, address adapter, address comet, bytes memory migrationData, uint256 flashAmount) = abi.decode(
            data,
            (address, address, address, bytes, uint256)
        );

        FlashData memory flashData = _flashData[comet];

        if (msg.sender != flashData.liquidityPool) revert SenderNotUniswapPool(msg.sender);

        uint256 flashAmountWithFee = flashAmount + (flashData.isToken0 ? fee0 : fee1);

        (bool success, bytes memory result) = adapter.delegatecall(
            abi.encodeWithSelector(IProtocolAdapter.executeMigration.selector, user, comet, migrationData)
        );

        if (!success) {
            if (result.length > 0) {
                assembly {
                    revert(add(32, result), mload(result))
                }
            } else {
                revert("Delegatecall failed");
            }
        }

        uint256 balance = IERC20NonStandard(flashData.baseToken).balanceOf(address(this));

        if (balance < flashAmountWithFee) {
            IComet(comet).withdrawFrom(user, address(this), address(flashData.baseToken), flashAmountWithFee - balance);
        }

        if (!_doTransferOut(IERC20NonStandard(flashData.baseToken), flashData.liquidityPool, flashAmountWithFee)) {
            revert ERC20TransferFailure();
        }

        emit MigrationExecuted(adapter, user, comet, flashAmount, (flashAmountWithFee - flashAmount));
    }

    /**
     * @notice Adds a new adapter to the list of allowed adapters.
     * @param adapter Address of the protocol adapter to add.
     * @dev Reverts with {InvalidZeroAddress} if the adapter address is zero.
     */
    function _setAdapter(address adapter) private {
        if (adapter == address(0)) revert InvalidZeroAddress();
        if (allowedAdapters[adapter]) revert AdapterAlreadyAllowed(adapter);

        allowedAdapters[adapter] = true;
        _adapters.push(adapter);

        emit AdapterAllowed(adapter);
    }

    /**
     * @notice Removes an adapter from the list of allowed adapters.
     * @param adapter Address of the protocol adapter to remove.
     * @dev Reverts if the adapter is not currently allowed.
     */
    function _removeAdapter(address adapter) private validAdapter(adapter) {
        allowedAdapters[adapter] = false;
        for (uint256 i = 0; i < _adapters.length; i++) {
            if (_adapters[i] == adapter) {
                _adapters[i] = _adapters[_adapters.length - 1];
                _adapters.pop();
                break;
            }
        }

        emit AdapterRemoved(adapter);
    }

    /**
     * @notice Sets flash loan configuration details for a specific Comet contract.
     * @param comet Address of the Comet contract.
     * @param flashData Struct containing flash loan details (liquidity pool, base token, token0 status).
     * @dev Reverts with {InvalidZeroAddress} if any address in the `flashData` is zero.
     */
    function _setFlashData(address comet, FlashData memory flashData) private {
        if (flashData.liquidityPool == address(0) || flashData.baseToken == address(0)) {
            revert InvalidZeroAddress();
        }

        if (_flashData[comet].liquidityPool != address(0)) {
            revert CometAlreadyConfigured(comet);
        }

        _flashData[comet] = FlashData(flashData.liquidityPool, flashData.baseToken, flashData.isToken0);

        emit FlashDataConfigured(comet, flashData.liquidityPool, flashData.baseToken);
    }

    /**
     * @notice Removes flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract to remove flash data for.
     * @dev Reverts if the Comet contract does not have associated flash loan data.
     */
    function _removeFlashData(address comet) private validComet(comet) {
        delete _flashData[comet];

        emit FlashDataRemoved(comet);
    }

    /**
     * @notice Handles token transfers while supporting both standard and non-standard ERC-20 tokens.
     * @param asset The ERC-20 token to transfer out.
     * @param to The recipient of the token transfer.
     * @param amount The amount of tokens to transfer.
     * @return Boolean indicating the success of the transfer.
     * @dev Safely handles tokens that do not return a success value on transfer.
     */
    function _doTransferOut(IERC20NonStandard asset, address to, uint256 amount) private returns (bool) {
        asset.transfer(to, amount);

        bool success;
        assembly {
            switch returndatasize()
            case 0 {
                // Non-standard ERC-20: no return value, assume success.
                success := not(0) // Set success to true.
            }
            case 32 {
                // Standard ERC-20: return value is a single boolean.
                returndatacopy(0, 0, 32)
                success := mload(0) // Load the return value into success.
            }
            default {
                // Invalid ERC-20: unexpected return data size.
                revert(0, 0)
            }
        }
        return success;
    }
}
