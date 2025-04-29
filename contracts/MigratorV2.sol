// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IUniswapV3FlashCallback} from "./interfaces/@uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./interfaces/@uniswap/v3-core/IUniswapV3Pool.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IComet} from "./interfaces/IComet.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title MigratorV2
 * @notice Facilitates the migration of user positions from external lending protocols into Compound III (Comet),
 *         optionally using Uniswap V3 flash loans to cover liquidity gaps.
 *
 * @dev Supports protocol-specific migrations via modular adapters, which handle collateral withdrawal, debt repayment,
 *      and asset supply to the target Comet market. Flash loans are validated using precomputed hashes to ensure security.
 *
 * Key Features:
 * - Modular adapter system for protocol-specific migration logic.
 * - Optional Uniswap V3 flash loans for liquidity management.
 * - Owner-controlled adapter registration and flash loan configuration.
 *
 * Core Flow:
 * 1. User initiates migration via `migrate()` with adapter, target Comet, migration data, and optional flash loan amount.
 * 2. If `flashAmount > 0`, a flash loan is requested, and `uniswapV3FlashCallback()` handles repayment and migration.
 * 3. If `flashAmount == 0`, migration is executed directly without borrowing.
 * 4. Emits `MigrationExecuted` upon success.
 *
 * Security:
 * - Only whitelisted adapters and configured Comet contracts are allowed.
 * - Flash loan callbacks are strictly validated by hash and sender address.
 *
 * Limitations:
 * - Assumes adapter logic is secure and performs proper token accounting.
 * - Assumes flash loan repayment tokens are supported by Uniswap V3 and Comet.
 */
contract MigratorV2 is IUniswapV3FlashCallback, ReentrancyGuard, Pausable, Ownable {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

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

    /// @notice Hash of the callback data used to validate the callback
    bytes32 private _storedCallbackHash;

    /**
     * @dev Array of registered protocol adapters.
     * @dev This is an enumerable set to allow for efficient management of adapters.
     */
    EnumerableSet.AddressSet private _adapters;

    uint256 private _preBaseAssetBalance;

    /**
     * @dev This mapping is used to store the flash loan configuration for each supported Comet contract.
     *      It ensures that only pre-configured Comet contracts can be targeted for migrations.
     */
    mapping(address comet => FlashData config) private _flashData;

    /**
     * @notice Address of the DAI token.
     */
    address public immutable DAI;

    /**
     * @notice Address of the USDS token.
     */
    address public immutable USDS;

    /**
     * @dev Mapping to track whether an address is a registered protocol adapter.
     */
    mapping(address adapter => bool status) public allowedAdapters;

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

    /**
     * @dev Reverts if the callback data hash does not match the stored hash.
     */
    error InvalidCallbackHash();

    /**
     * @dev Reverts if the delegatecall fails.
     */
    error DelegatecallFailed();

    /**
     * @dev Reverts if the base token is not as expected.
     * @param expected Address of the expected base token.
     * @param actual Address of the actual base token provided.
     */
    error BaseTokenMismatch(address expected, address actual);

    /// @dev Thrown when DAI and USDS addresses are inconsistent or identical when non-zero.
    error AddressPairMismatch(address dai, address usds);

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
     * @dev This event is emitted by the `_removeFlashData` function when the flash loan configuration for a specific Comet contract is removed.
     *      Removing flash loan data prevents the contract from using flash loans for that Comet market.
     */
    event FlashDataRemoved(address indexed comet);

    /// --------Modifiers-------- ///

    /**
     * @notice Ensures that the provided adapter address is valid.
     * @param adapter Address of the protocol adapter to validate.
     * @dev Checks the `allowedAdapters` mapping to validate the adapter address.
     * @dev Reverts with {InvalidAdapter} if the adapter is not allowed.
     */
    modifier validAdapter(address adapter) {
        if (!allowedAdapters[adapter]) revert InvalidAdapter();
        _;
    }

    /**
     * @notice Ensures that the provided Comet address is supported.
     * @param comet Address of the Comet contract to validate.
     * @dev Checks the `_flashData` mapping to validate the Comet contract address.
     * @dev Reverts with {CometIsNotSupported} if the Comet contract is not supported.
     * @dev This modifier is applied to functions that require the target Comet contract to have valid flash loan data.
     *      It ensures that only pre-configured Comet contracts can be interacted with.
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
     *
     * @dev This constructor:
     *  - Sets the contract owner to the `multisig` address.
     *  - Registers protocol adapters provided in the `adapters` array.
     *  - Configures flash loan data for each corresponding Comet contract using the `flashData` array.
     *  - The contract does not automatically pause, even if arrays are empty. The caller should invoke `pause()` if needed.
     *  - Internally calls `_setAdapter` for each adapter and `_setFlashData` for each Comet contract.
     *
     * @dev Reverts with:
     *  - {InvalidZeroAddress} if any address within the inputs is zero.
     *  - {MismatchedArrayLengths} if the length of `comets` and `flashData` arrays do not match.
     */
    constructor(
        address multisig,
        address[] memory adapters,
        address[] memory comets,
        FlashData[] memory flashData,
        address dai,
        address usds
    ) ReentrancyGuard() Pausable() Ownable(multisig) {
        uint256 configLength = comets.length;
        uint256 adapterLength = adapters.length;
        // Ensure `comets` and `flashData` arrays have matching lengths
        if (configLength != flashData.length) revert MismatchedArrayLengths();

        if ((dai == address(0)) != (usds == address(0)) || (dai != address(0) && dai == usds))
            revert AddressPairMismatch(dai, usds);

        DAI = dai;
        USDS = usds;

        // Register each adapter
        for (uint256 i = 0; i < adapterLength; i++) {
            _setAdapter(adapters[i]);
        }

        // Configure flash loan data for each corresponding Comet
        for (uint256 i = 0; i < configLength; i++) {
            _setFlashData(comets[i], flashData[i]);
        }
    }

    /// --------Functions-------- ///

    /**
     * @notice Initiates a user position migration into Compound III (Comet) via a registered protocol adapter.
     *
     * @dev This function performs the following:
     *  1. Validates that the specified adapter is registered and that the target Comet contract is configured.
     *  2. Ensures the provided `migrationData` is not empty.
     *  3. Encodes and hashes the migration context for later verification during callback execution.
     *  4. If `flashAmount > 0`, initiates a flash loan from the configured Uniswap V3 pool by calling its `flash()` method.
     *  5. If `flashAmount == 0`, calls the adapter directly via `delegatecall` and passes encoded flashloanData with amount 0.
     *  6. If the delegatecall succeeds, emits the {MigrationExecuted} event with zero flash fee.
     *  7. Stores a callback hash only for the duration of the function execution to validate flash loan integrity.
     *
     * @param adapter The address of the protocol adapter responsible for handling migration logic.
     * @param comet The address of the target Compound III (Comet) market.
     * @param migrationData ABI-encoded input containing migration strategy and user-specific data.
     * @param flashAmount The amount of tokens to borrow via Uniswap V3 flash loan. Use zero if no borrowing is needed.
     *
     * Requirements:
     * - `adapter` must be registered in `allowedAdapters`.
     * - `comet` must have associated flash loan configuration (`_flashData[comet]`).
     * - `migrationData` must not be empty.
     *
     * Effects:
     * - Stores a callback hash to validate flash loan integrity.
     * - Either initiates a flash loan or directly calls the adapter logic depending on `flashAmount`.
     * - Emits {MigrationExecuted} upon successful completion.
     *
     * Reverts:
     * - {InvalidMigrationData} if `migrationData.length == 0`.
     * - {InvalidAdapter} if the adapter is not registered.
     * - {CometIsNotSupported} if flash data for `comet` is missing.
     * - {DelegatecallFailed} if adapter delegatecall fails and returns an error payload.
     */
    function migrate(
        address adapter,
        address comet,
        bytes calldata migrationData,
        uint256 flashAmount
    ) external nonReentrant validAdapter(adapter) validComet(comet) whenNotPaused {
        if (migrationData.length == 0) revert InvalidMigrationData();

        // Get the address of the user initiating the migration
        // This is the address that will be used to execute the migration
        // and will be the recipient of any tokens after the migration is complete
        address user = msg.sender;

        FlashData memory flashData = _flashData[comet];

        // Store the own pre-balance of base asset before migration
        _preBaseAssetBalance = IERC20(flashData.baseToken).balanceOf(address(this));

        bytes memory callbackData = abi.encode(user, adapter, comet, migrationData, flashAmount, _preBaseAssetBalance);

        // Stored hash the callback data to validate it later
        _storedCallbackHash = keccak256(callbackData);

        if (flashAmount != 0) {
            IUniswapV3Pool(flashData.liquidityPool).flash(
                address(this),
                flashData.isToken0 ? flashAmount : 0,
                flashData.isToken0 ? 0 : flashAmount,
                callbackData
            );
        } else {
            (bool success, bytes memory result) = adapter.delegatecall(
                abi.encodeCall(
                    IProtocolAdapter.executeMigration,
                    (user, comet, migrationData, new bytes(0), _preBaseAssetBalance)
                )
            );

            if (!success && result.length == 0) {
                revert DelegatecallFailed();
            } else if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            } else {
                emit MigrationExecuted(adapter, user, comet, 0, 0);
            }
        }
        // Clear the stored callback hash
        _storedCallbackHash = bytes32(0);

        // Clear the pre-balance of base asset
        _preBaseAssetBalance = 0;
    }

    /**
     * @notice Executes migration logic during the Uniswap V3 flash loan callback.
     *
     * @dev This function is invoked by the Uniswap V3 pool after a flash loan is issued.
     * It performs the following steps:
     *  1. Validates the callback integrity by comparing the `keccak256` hash of the provided `data`
     *     with the stored `_storedCallbackHash`.
     *  2. Decodes the migration context including the user address, adapter, comet, and migration input.
     *  3. Verifies that the caller is the expected Uniswap V3 pool associated with the target `comet`.
     *  4. Computes the repayment amount, including Uniswap's flash loan fee.
     *  5. Invokes the protocol adapter logic via `delegatecall`, passing the full context and encoded flash loan details.
     *  6. Emits the {MigrationExecuted} event if the adapter call succeeds.
     *
     * @param fee0 The fee owed for borrowing `token0` from the Uniswap pool.
     * @param fee1 The fee owed for borrowing `token1` from the Uniswap pool.
     * @param data ABI-encoded callback payload containing:
     *        - user: Address of the user initiating the migration.
     *        - adapter: Address of the protocol adapter.
     *        - comet: Address of the Comet market.
     *        - migrationData: Adapter-specific migration data.
     *        - flashAmount: The amount borrowed via flash loan.
     *
     * Requirements:
     * - The function must be called by the exact Uniswap V3 liquidity pool configured for the `comet`.
     * - The hash of `data` must match `_storedCallbackHash`.
     * - The protocol adapter must successfully execute the migration via `delegatecall`.
     *
     * Effects:
     * - Executes custom migration logic using the borrowed liquidity.
     * - Emits {MigrationExecuted} with flash amount and computed fee.
     *
     * Reverts:
     * - {InvalidCallbackHash} if the callback data does not match expectations.
     * - {SenderNotUniswapPool} if the caller is not the configured Uniswap pool.
     * - {DelegatecallFailed} or raw revert if adapter execution fails.
     */
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {
        if (keccak256(data) != _storedCallbackHash) revert InvalidCallbackHash();

        (
            address user,
            address adapter,
            address comet,
            bytes memory migrationData,
            uint256 flashAmount,
            uint256 preBaseAssetBalance
        ) = abi.decode(data, (address, address, address, bytes, uint256, uint256));

        FlashData memory flashData = _flashData[comet];

        if (msg.sender != flashData.liquidityPool) revert SenderNotUniswapPool(msg.sender);

        uint256 flashAmountWithFee = flashAmount + (flashData.isToken0 ? fee0 : fee1);

        bytes memory flashloanData = abi.encode(flashData.liquidityPool, flashData.baseToken, flashAmountWithFee);

        (bool success, bytes memory result) = adapter.delegatecall(
            abi.encodeCall(
                IProtocolAdapter.executeMigration,
                (user, comet, migrationData, flashloanData, preBaseAssetBalance)
            )
        );

        if (!success && result.length == 0) {
            revert DelegatecallFailed();
        } else if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        } else {
            emit MigrationExecuted(adapter, user, comet, flashAmount, (flashAmountWithFee - flashAmount));
        }
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
    function removeAdapter(address adapter) external onlyOwner whenPaused {
        _removeAdapter(adapter);
    }

    /**
     * @notice Sets flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract.
     * @param flashData Struct containing flash loan configuration details (liquidity pool, base token, token0 status).
     * @dev Validates the flashData parameters and updates the mapping.
     * @dev Reverts with {InvalidZeroAddress} if any address in the flashData is zero.
     */
    function setFlashData(address comet, FlashData calldata flashData) external onlyOwner {
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
     * @dev This function is restricted to the contract owner via the `onlyOwner` modifier.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /// --------View Functions-------- ///

    /**
     * @notice Retrieves the list of registered protocol adapters.
     * @dev Uses the `EnumerableSet` library to retrieve the list of registered protocol adapters.
     * @return Array of all registered protocol adapter addresses.
     */

    function getAdapters() external view returns (address[] memory) {
        return _adapters.values();
    }

    /**
     * @notice Retrieves the flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract.
     * @dev Retrieves the flash loan configuration from the `_flashData` mapping for the specified `comet`.
     * @return The flash loan configuration details, including the liquidity pool, base token, and token0 status.
     */
    function getFlashData(address comet) external view returns (FlashData memory) {
        return _flashData[comet];
    }

    function getEncodedDaiToUsdsConversionPath() external view returns (bytes memory) {
        return abi.encodePacked(DAI, USDS);
    }

    function getEncodedUsdsToDaiConversionPath() external view returns (bytes memory) {
        return abi.encodePacked(USDS, DAI);
    }

    /// --------Private Functions-------- ///

    /**
     * @notice Adds a new adapter to the list of allowed adapters.
     * @param adapter Address of the protocol adapter to add.
     * @dev Updates the `allowedAdapters` mapping and adds the adapter to the `_adapters` enumerable set.
     * @dev Reverts with {InvalidZeroAddress} if the adapter address is zero.
     * @dev Reverts with {AdapterAlreadyAllowed} if the adapter is already registered in `allowedAdapters`.
     * @dev Emits an {AdapterAllowed} event upon successful registration of the adapter.
     */
    function _setAdapter(address adapter) private {
        if (adapter == address(0)) revert InvalidZeroAddress();
        if (allowedAdapters[adapter]) revert AdapterAlreadyAllowed(adapter);

        allowedAdapters[adapter] = true;
        _adapters.add(adapter);
        // Emit an event to notify that the adapter has been allowed
        emit AdapterAllowed(adapter);
    }

    /**
     * @notice Removes an adapter from the list of allowed adapters.
     * @param adapter Address of the protocol adapter to remove.
     * @dev Updates the `allowedAdapters` mapping and removes the adapter from the `_adapters` enumerable set.
     * @dev Reverts with {InvalidAdapter} if the adapter is not currently allowed.
     * @dev Emits an {AdapterRemoved} event upon successful removal of the adapter.
     */
    function _removeAdapter(address adapter) private validAdapter(adapter) {
        allowedAdapters[adapter] = false;
        _adapters.remove(adapter);
        // Emit an event to notify that the adapter has been removed
        emit AdapterRemoved(adapter);
    }

    /**
     * @notice Sets flash loan configuration details for a specific Comet contract.
     * @param comet Address of the Comet contract.
     * @param flashData Struct containing flash loan details (liquidity pool, base token, token0 status).
     * @dev This is a private function and can only be called internally.
     * @dev Updates the `_flashData` mapping with the provided configuration for the specified `comet`.
     * @dev Reverts with {InvalidZeroAddress} if any address in the `flashData` is zero.
     * @dev Reverts with {CometAlreadyConfigured} if the Comet contract is already configured.
     * @dev Emits a {FlashDataConfigured} event upon successful configuration with the `comet`, `liquidityPool`, and `baseToken` parameters.
     */
    function _setFlashData(address comet, FlashData memory flashData) private {
        if (flashData.liquidityPool == address(0) || flashData.baseToken == address(0)) {
            revert InvalidZeroAddress();
        }

        if (_flashData[comet].liquidityPool != address(0)) {
            revert CometAlreadyConfigured(comet);
        }

        address cometBaseToken = address(IComet(comet).baseToken());

        if (flashData.baseToken == cometBaseToken || (flashData.baseToken == DAI && cometBaseToken == USDS)) {
            _flashData[comet] = flashData;

            emit FlashDataConfigured(comet, flashData.liquidityPool, flashData.baseToken);
        } else {
            revert BaseTokenMismatch((cometBaseToken == USDS ? DAI : cometBaseToken), flashData.baseToken);
        }
    }

    /**
     * @notice Removes flash loan configuration for a specific Comet contract.
     * @param comet Address of the Comet contract to remove flash data for.
     * @dev This is a private function and can only be called internally.
     * @dev Deletes the flash loan configuration for the specified `comet` from the `_flashData` mapping.
     * @dev Reverts with {InvalidComet} if the Comet contract does not have associated flash loan data.
     * @dev Emits a {FlashDataRemoved} event upon successful removal.
     */
    function _removeFlashData(address comet) private validComet(comet) {
        delete _flashData[comet];

        emit FlashDataRemoved(comet);
    }
}
