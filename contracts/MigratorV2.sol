// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IUniswapV3FlashCallback} from "./interfaces/uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./interfaces/uniswap/v3-core/IUniswapV3Pool.sol";
import {IComet} from "./interfaces/IComet.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {CommonErrors} from "./errors/CommonErrors.sol";

/**
 * @title MigratorV2
 * @notice Facilitates the migration of user positions from external lending protocols (e.g., Aave V3, Morpho, Spark)
 *         into Compound III (Comet), optionally using Uniswap V3 flash loans to cover liquidity gaps.
 *
 * @dev Supports protocol-specific migrations via modular adapters, which handle collateral withdrawal, debt repayment,
 *      and asset supply to the target Comet market. Flash loans are validated using precomputed hashes to ensure security.
 *      Integrates with `SwapModule` for Uniswap V3 swaps and `ConvertModule` for DAI ⇄ USDS conversions.
 *
 * Key Features:
 * - Modular adapter system for protocol-specific migration logic.
 * - Optional Uniswap V3 flash loans for liquidity management.
 * - Owner-controlled adapter registration and flash loan configuration.
 * - Supports stablecoin conversions (DAI ⇄ USDS) for USDS-based Comet markets.
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
 * - Adapters must implement `IProtocolAdapter` and are executed via `delegatecall`.
 *
 * Limitations:
 * - Assumes adapter logic is secure and performs proper token accounting.
 * - Assumes flash loan repayment tokens are supported by Uniswap V3 and Comet.
 * - Relies on external modules (`SwapModule`, `ConvertModule`) for swaps and conversions.
 *
 * Warning:
 * - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts.
 */
contract MigratorV2 is CommonErrors, IUniswapV3FlashCallback, ReentrancyGuard, Pausable, Ownable {
    /// -------- Libraries -------- ///

    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// --------Types-------- ///

    /**
     * @notice Struct to hold flash loan configuration details for a specific Compound III (Comet) market.
     *
     * @param liquidityPool Address of the Uniswap V3 pool used for the flash loan.
     * @param baseToken Address of the token involved in the flash loan.
     * @param isToken0 Boolean indicating whether the `baseToken` is token0 in the Uniswap V3 liquidity pool.
     *
     * @dev This struct is used to configure flash loan parameters for each supported Comet market.
     *      It ensures compatibility between the Uniswap V3 pool and the Comet market's base token.
     */
    struct FlashData {
        address liquidityPool;
        address baseToken;
        bool isToken0;
    }

    /// --------State Variables-------- ///

    /**
     * @notice Hash of the callback data used to validate the integrity of Uniswap V3 flash loan callbacks.
     * @dev This hash is computed during `migrate()` and validated in `uniswapV3FlashCallback()`.
     */ bytes32 private _storedCallbackHash;

    /**
     * @notice Set of registered protocol adapters.
     * @dev Uses the `EnumerableSet` library for efficient management of adapters.
     *      Adapters must implement the `IProtocolAdapter` interface and are executed via `delegatecall`.
     */
    EnumerableSet.AddressSet private _adapters;

    uint256 private _preBaseAssetBalance;

    /**
     * @notice Mapping of Comet contracts to their flash loan configurations.
     * @dev Stores details such as the Uniswap V3 liquidity pool, base token, and token0 status.
     *      Ensures that only pre-configured Comet contracts can be targeted for migrations.
     */
    mapping(address comet => FlashData config) private _flashData;

    /**
     * @notice Address of the DAI token.
     * @dev Used for stablecoin conversions in USDS-based Comet markets.
     */
    address public immutable DAI;

    /**
     * @notice Address of the USDS token.
     * @dev Used for stablecoin conversions in USDS-based Comet markets.
     */
    address public immutable USDS;

    /// --------Errors-------- ///

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
     * @notice Reverts if the base token in the flash loan configuration does not match the Comet base token.
     * @param expected Address of the expected base token.
     * @param actual Address of the actual base token provided.
     * @dev Ensures compatibility between the flash loan token and the Comet market.
     */
    error BaseTokenMismatch(address expected, address actual);

    /// @dev Thrown when DAI and USDS addresses are inconsistent or identical when non-zero.
    error AddressPairMismatch(address dai, address usds);

    /// --------Events-------- ///

    /**
     * @notice Emitted when a migration is successfully executed.
     *
     * @param adapter The address of the protocol adapter used for the migration.
     * @param user The address of the user initiating the migration.
     * @param comet The address of the Compound III (Comet) market associated with the migration.
     * @param flashAmount The amount borrowed via the Uniswap V3 flash loan (if any).
     * @param flashFee The fee paid for the flash loan (if any).
     *
     * @dev This event is emitted upon the successful completion of a migration, whether it involves a flash loan or not.
     *      It provides details about the adapter, user, target Comet market, and any flash loan parameters.
     */
    event MigrationExecuted(
        address indexed adapter,
        address indexed user,
        address indexed comet,
        uint256 flashAmount,
        uint256 flashFee
    );

    /**
     * @notice Emitted when a protocol adapter is successfully registered.
     *
     * @param adapter The address of the protocol adapter that was registered.
     *
     * @dev This event is emitted whenever a new adapter is added to the `_adapters` enumerable set.
     *      It indicates that the adapter is now authorized to handle migrations via the `migrate` function.
     */
    event AdapterAllowed(address indexed adapter);

    /**
     * @notice Emitted when a protocol adapter is removed from the list of allowed adapters.
     *
     * @param adapter The address of the protocol adapter that was removed.
     *
     * @dev This event is emitted whenever an adapter is removed from the `_adapters` enumerable set.
     *      It indicates that the adapter is no longer authorized to handle migrations via the `migrate` function.
     */
    event AdapterRemoved(address indexed adapter);

    /**
     * @notice Emitted when flash loan data is configured for a specific Compound III (Comet) market.
     *
     * @param comet The address of the Comet contract for which the flash loan data is configured.
     * @param liquidityPool The address of the Uniswap V3 pool used for the flash loan.
     * @param baseToken The address of the token involved in the flash loan.
     *
     * @dev This event is emitted whenever flash loan parameters are successfully set for a Comet market.
     *      It indicates that the specified Comet market is now configured to support flash loans.
     */
    event FlashDataConfigured(address indexed comet, address indexed liquidityPool, address indexed baseToken);

    /**
     * @notice Emitted when flash loan data is removed for a specific Compound III (Comet) market.
     *
     * @param comet The address of the Comet contract whose flash loan configuration was removed.
     *
     * @dev This event is emitted whenever the flash loan configuration for a specific Comet market
     *      is deleted from the `_flashData` mapping. It indicates that the specified Comet market
     *      no longer supports flash loans for migrations.
     */
    event FlashDataRemoved(address indexed comet);

    /// --------Modifiers-------- ///

    /**
     * @notice Ensures that the provided adapter address is valid and registered.
     *
     * @dev This modifier checks if the specified adapter is included in the `_adapters` enumerable set.
     *      If the adapter is not registered, the transaction will revert with an {InvalidAdapter} error.
     *
     * Requirements:
     * - The `adapter` address must be registered in the `_adapters` enumerable set.
     *
     * Reverts:
     * - {InvalidAdapter} if the adapter is not currently registered.
     *
     * Usage:
     * - Apply this modifier to functions that require a valid and registered adapter to execute.
     *
     * @param adapter The address of the protocol adapter to validate.
     */
    modifier validAdapter(address adapter) {
        if (!_adapters.contains(adapter)) revert InvalidAdapter();
        _;
    }

    /**
     * @notice Ensures that the provided Comet address has a valid flash loan configuration.
     *
     * @param comet The address of the Comet contract to validate.
     *
     * @dev This modifier checks the `_flashData` mapping to confirm that the specified Comet contract
     *      has an associated flash loan configuration. If the configuration is missing, the transaction reverts.
     *
     * Reverts:
     * - {CometIsNotSupported} if the `comet` address does not have an associated flash loan configuration.
     */
    modifier validComet(address comet) {
        if (_flashData[comet].liquidityPool == address(0)) revert CometIsNotSupported(comet);
        _;
    }

    /**
     * @notice Initializes the MigratorV2 contract with the provided parameters.
     *
     * @param multisig Address of the multisig wallet for contract ownership.
     * @param adapters Array of protocol adapter addresses to register.
     * @param comets Array of Comet contract addresses to support.
     * @param flashData Array of flash loan configurations corresponding to each Comet contract.
     * @param dai Address of the DAI token.
     * @param usds Address of the USDS token.
     *
     * @dev This constructor performs the following:
     *  - Sets the contract owner to the `multisig` address.
     *  - Registers protocol adapters provided in the `adapters` array.
     *  - Configures flash loan data for each corresponding Comet contract using the `flashData` array.
     *  - Validates that the `dai` and `usds` addresses are either both zero or both non-zero, and that they are not identical.
     *  - Ensures that the lengths of the `comets` and `flashData` arrays match.
     *
     * Requirements:
     * - `multisig` must not be a zero address.
     * - `dai` and `usds` must either both be zero or both be non-zero, and they must not be identical.
     * - The lengths of the `comets` and `flashData` arrays must match.
     *
     * Reverts:
     * - {InvalidZeroAddress} if any address within the inputs is zero.
     * - {MismatchedArrayLengths} if the lengths of `comets` and `flashData` arrays do not match.
     * - {AddressPairMismatch} if `dai` and `usds` are inconsistent or identical when non-zero.
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
     * - `adapter` must be registered in `_adapters` enumerable set.
     * - `comet` must have associated flash loan configuration (`_flashData[comet]`).
     * - `migrationData` must not be empty.
     * - User must approve this contract to transfer relevant collateral and debt positions.
     * - The user must grant permission to the Migrator contract to interact with their tokens in the target Compound III market:
     *   `IComet.allow(migratorV2.address, true)`.
     * - Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
     * - Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).
     * - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment.
     *
     * Effects:
     * - Stores a callback hash to validate flash loan integrity.
     * - Either initiates a flash loan or directly calls the adapter logic depending on `flashAmount`.
     * - Emits {MigrationExecuted} upon successful completion.
     *
     * Warning:
     * - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts.
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
     *
     * @dev This function adds the specified adapter to the `_adapters` enumerable set.
     *      Once registered, the adapter can be used for migrations via the `migrate` function.
     *
     * @param adapter The address of the protocol adapter to register.
     *
     * Requirements:
     * - The caller must be the contract owner.
     * - The `adapter` address must not be zero.
     * - The `adapter` must not already be registered in `_adapters` enumerable set.
     *
     * Effects:
     * - Adds the adapter to the `_adapters` enumerable set.
     * - Emits an {AdapterAllowed} event upon successful registration.
     *
     * Reverts:
     * - {InvalidZeroAddress} if the `adapter` address is zero.
     * - {AdapterAlreadyAllowed} if the `adapter` is already registered.
     */
    function setAdapter(address adapter) external onlyOwner {
        _setAdapter(adapter);
    }

    /**
     * @notice Removes an existing protocol adapter from the list of allowed adapters.
     *
     * @dev This function removes the specified adapter from the `_adapters` enumerable set.
     *      Once removed, the adapter can no longer be used for migrations.
     *
     * @param adapter The address of the protocol adapter to remove.
     *
     * Requirements:
     * - The caller must be the contract owner.
     * - The contract must be in a paused state.
     * - The `adapter` must currently be registered in `_adapters`.
     *
     * Effects:
     * - Removes the adapter from the `_adapters` enumerable set.
     * - Emits an {AdapterRemoved} event upon successful removal.
     *
     * Reverts:
     * - {InvalidAdapter} if the adapter is not currently allowed.
     */
    function removeAdapter(address adapter) external onlyOwner whenPaused {
        _removeAdapter(adapter);
    }

    /**
     * @notice Removes the flash loan configuration for a specific Compound III (Comet) market.
     *
     * @dev This function deletes the flash loan configuration associated with the given `comet` address
     *      from the `_flashData` mapping. Once removed, the specified Comet market will no longer support
     *      flash loans for migrations.
     *
     * @param comet The address of the Comet contract whose flash loan configuration is being removed.
     *
     * Requirements:
     * - The caller must be the contract owner.
     * - The `comet` address must have an existing flash loan configuration in `_flashData`.
     *
     * Effects:
     * - Deletes the flash loan configuration for the specified `comet` from the `_flashData` mapping.
     * - Emits a {FlashDataRemoved} event upon successful removal.
     *
     * Reverts:
     * - {CometIsNotSupported} if the `comet` address does not have an associated flash loan configuration.
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
     *
     * @dev This function pauses the contract, preventing any migration operations from being executed.
     *      It can only be called by the contract owner.
     *
     * Requirements:
     * - The caller must be the contract owner.
     *
     * Effects:
     * - Emits a {Paused} event upon successful execution.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes all migration operations after being paused.
     *
     * @dev This function unpauses the contract, allowing migration operations to resume.
     *      It can only be called by the contract owner.
     *
     * Requirements:
     * - The contract must be in a paused state.
     * - The caller must be the contract owner.
     *
     * Effects:
     * - Emits an {Unpaused} event upon successful execution.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /// --------View Functions-------- ///

    /**
     * @notice Retrieves the list of all registered protocol adapters.
     *
     * @dev This function uses the `EnumerableSet` library to efficiently retrieve the addresses of all
     *      protocol adapters currently registered in the `_adapters` set.
     *
     * @return An array of addresses representing all registered protocol adapters.
     *
     * Usage:
     * - This function can be called to verify which adapters are currently allowed for migrations.
     */
    function getAdapters() external view returns (address[] memory) {
        return _adapters.values();
    }

    /**
     * @notice Retrieves the flash loan configuration for a specific Compound III (Comet) market.
     *
     * @param comet The address of the Comet contract whose flash loan configuration is being retrieved.
     *
     * @return The `FlashData` struct containing the following details:
     *         - `liquidityPool`: Address of the Uniswap V3 pool used for the flash loan.
     *         - `baseToken`: Address of the token involved in the flash loan.
     *         - `isToken0`: Boolean indicating whether the `baseToken` is token0 in the Uniswap V3 liquidity pool.
     *
     * @dev This function allows external callers to fetch the flash loan configuration for a specific Comet market.
     *      The configuration must have been previously set using the `_setFlashData` function.
     *
     * Requirements:
     * - The `comet` address must have an existing flash loan configuration in `_flashData`.
     *
     * Usage:
     * - Can be used to verify the flash loan setup for a specific Comet market before initiating a migration.
     */
    function getFlashData(address comet) external view returns (FlashData memory) {
        return _flashData[comet];
    }

    /**
     * @notice Retrieves the encoded Uniswap V3 swap path for converting DAI to USDS.
     *
     * @dev This function returns the ABI-encoded path used for Uniswap V3 swaps, specifying the sequence of tokens
     *      involved in the conversion from DAI to USDS. The path is constructed using the `abi.encodePacked` function.
     *
     * @return The ABI-encoded swap path for converting DAI to USDS.
     *
     * Usage:
     * - This path can be used as input for Uniswap V3 swap functions to perform the DAI ⇄ USDS conversion.
     *
     * Requirements:
     * - The `DAI` and `USDS` addresses must be correctly initialized during contract deployment.
     */
    function getEncodedDaiToUsdsConversionPath() external view returns (bytes memory) {
        return abi.encodePacked(DAI, USDS);
    }

    /**
     * @notice Retrieves the encoded Uniswap V3 swap path for converting USDS to DAI.
     *
     * @dev This function returns the ABI-encoded path used for Uniswap V3 swaps, specifying the sequence of tokens
     *      involved in the conversion from USDS to DAI. The path is constructed using the `abi.encodePacked` function.
     *
     * @return The ABI-encoded swap path for converting USDS to DAI.
     *
     * Usage:
     * - This path can be used as input for Uniswap V3 swap functions to perform the USDS ⇄ DAI conversion.
     *
     * Requirements:
     * - The `USDS` and `DAI` addresses must be correctly initialized during contract deployment.
     */
    function getEncodedUsdsToDaiConversionPath() external view returns (bytes memory) {
        return abi.encodePacked(USDS, DAI);
    }

    /// --------Private Functions-------- ///

    /**
     * @notice Registers a new protocol adapter.
     *
     * @dev This function adds the specified adapter to the `_adapters` enumerable set.
     *      Once registered, the adapter can be used for migrations via the `migrate` function.
     *
     * @param adapter The address of the protocol adapter to register.
     *
     * Requirements:
     * - The `adapter` address must not be zero.
     * - The `adapter` must not already be registered in `_adapters` enumerable set.
     *
     * Effects:
     * - Adds the adapter to the `_adapters` enumerable set.
     * - Emits an {AdapterAllowed} event upon successful registration.
     *
     * Reverts:
     * - {InvalidZeroAddress} if the `adapter` address is zero.
     * - {AdapterAlreadyAllowed} if the `adapter` is already registered.
     */
    function _setAdapter(address adapter) private {
        if (adapter == address(0)) revert InvalidZeroAddress();
        if (_adapters.contains(adapter)) revert AdapterAlreadyAllowed(adapter);

        _adapters.add(adapter);
        // Emit an event to notify that the adapter has been allowed
        emit AdapterAllowed(adapter);
    }

    /**
     * @notice Removes a protocol adapter from the list of allowed adapters.
     *
     * @dev This function removes the specified adapter from the `_adapters` enumerable set.
     *      Once removed, the adapter can no longer be used for migrations.
     *
     * Emits:
     * - {AdapterRemoved} event upon successful removal of the adapter.
     *
     * Requirements:
     * - The `adapter` must currently be registered in the `_adapters` enumerable set.
     *
     * Reverts:
     * - {InvalidAdapter} if the adapter is not currently registered.
     *
     * @param adapter The address of the protocol adapter to remove.
     */
    function _removeAdapter(address adapter) private validAdapter(adapter) {
        _adapters.remove(adapter);
        // Emit an event to notify that the adapter has been removed
        emit AdapterRemoved(adapter);
    }

    /**
     * @notice Configures flash loan parameters for a specific Compound III (Comet) market.
     *
     * @dev This function sets the flash loan configuration for the given `comet` address by storing the provided
     *      `flashData` in the `_flashData` mapping. It ensures compatibility between the Uniswap V3 liquidity pool
     *      and the Comet market's base token.
     *
     * @param comet The address of the Comet contract to configure flash loan parameters for.
     * @param flashData Struct containing the following flash loan configuration details:
     *        - `liquidityPool`: Address of the Uniswap V3 pool used for the flash loan.
     *        - `baseToken`: Address of the token involved in the flash loan.
     *        - `isToken0`: Boolean indicating whether the `baseToken` is token0 in the Uniswap V3 liquidity pool.
     *
     * Requirements:
     * - `flashData.liquidityPool` and `flashData.baseToken` must not be zero addresses.
     * - The `comet` address must not already have a flash loan configuration in `_flashData`.
     * - The `flashData.baseToken` must match the base token of the `comet` market or be compatible with USDS-based markets.
     *
     * Effects:
     * - Updates the `_flashData` mapping with the provided configuration for the specified `comet`.
     * - Emits a {FlashDataConfigured} event upon successful configuration.
     *
     * Reverts:
     * - {InvalidZeroAddress} if `flashData.liquidityPool` or `flashData.baseToken` is a zero address.
     * - {CometAlreadyConfigured} if the `comet` address is already configured.
     * - {BaseTokenMismatch} if the `flashData.baseToken` does not match the Comet base token or is incompatible.
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
     * @notice Removes the flash loan configuration for a specific Compound III (Comet) market.
     *
     * @dev This function deletes the flash loan configuration associated with the given `comet` address
     *      from the `_flashData` mapping. Once removed, the specified Comet market will no longer support
     *      flash loans for migrations.
     *
     * @param comet The address of the Comet contract whose flash loan configuration is being removed.
     *
     * Requirements:
     * - The `comet` address must have an existing flash loan configuration in `_flashData`.
     *
     * Effects:
     * - Deletes the flash loan configuration for the specified `comet` from the `_flashData` mapping.
     * - Emits a {FlashDataRemoved} event upon successful removal.
     *
     * Reverts:
     * - {CometIsNotSupported} if the `comet` address does not have an associated flash loan configuration.
     */
    function _removeFlashData(address comet) private validComet(comet) {
        delete _flashData[comet];

        emit FlashDataRemoved(comet);
    }
}
