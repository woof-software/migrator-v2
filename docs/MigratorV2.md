# Solidity API

## MigratorV2

Facilitates the migration of user positions from external lending protocols (e.g., Aave V3, Morpho, Spark)
        into Compound III (Comet), optionally using Uniswap V3 flash loans to cover liquidity gaps.

_Supports protocol-specific migrations via modular adapters, which handle collateral withdrawal, debt repayment,
     and asset supply to the target Comet market. Flash loans are validated using precomputed hashes to ensure security.
     Integrates with `SwapModule` for Uniswap V3 swaps and `ConvertModule` for DAI ⇄ USDS conversions.

Key Features:
- Modular adapter system for protocol-specific migration logic.
- Optional Uniswap V3 flash loans for liquidity management.
- Owner-controlled adapter registration and flash loan configuration.
- Supports stablecoin conversions (DAI ⇄ USDS) for USDS-based Comet markets.

Core Flow:
1. User initiates migration via `migrate()` with adapter, target Comet, migration data, and optional flash loan amount.
2. If `flashAmount > 0`, a flash loan is requested, and `uniswapV3FlashCallback()` handles repayment and migration.
3. If `flashAmount == 0`, migration is executed directly without borrowing.
4. Emits `MigrationExecuted` upon success.

Security:
- Only whitelisted adapters and configured Comet contracts are allowed.
- Flash loan callbacks are strictly validated by hash and sender address.
- Adapters must implement `IProtocolAdapter` and are executed via `delegatecall`.

Limitations:
- Assumes adapter logic is secure and performs proper token accounting.
- Assumes flash loan repayment tokens are supported by Uniswap V3 and Comet.
- Relies on external modules (`SwapModule`, `ConvertModule`) for swaps and conversions._

### FlashData

Struct to hold flash loan configuration details for a specific Compound III (Comet) market.

_This struct is used to configure flash loan parameters for each supported Comet market.
     It ensures compatibility between the Uniswap V3 pool and the Comet market's base token._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct FlashData {
  address liquidityPool;
  address baseToken;
  bool isToken0;
}
```

### DAI

```solidity
address DAI
```

Address of the DAI token.

_Used for stablecoin conversions in USDS-based Comet markets._

### USDS

```solidity
address USDS
```

Address of the USDS token.

_Used for stablecoin conversions in USDS-based Comet markets._

### allowedAdapters

```solidity
mapping(address => bool) allowedAdapters
```

Tracks the registration status of protocol adapters.

_This mapping associates each adapter address with a boolean value indicating whether the adapter is allowed.
     Adapters must implement the `IProtocolAdapter` interface and are executed via `delegatecall`.

 adapter - The address of the protocol adapter.
 status - A boolean value where `true` indicates the adapter is allowed, and `false` indicates it is not.

Usage:
- Adapters must be explicitly registered by the contract owner using the `setAdapter` function.
- Only allowed adapters can be used for migrations via the `migrate` function._

### InvalidMigrationData

```solidity
error InvalidMigrationData()
```

_Reverts if migration data is empty._

### InvalidAdapter

```solidity
error InvalidAdapter()
```

_Reverts if the adapter is not allowed._

### SenderNotUniswapPool

```solidity
error SenderNotUniswapPool(address sender)
```

_Reverts if the caller is not the expected Uniswap pool._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| sender | address | Address of the unexpected sender. |

### CometIsNotSupported

```solidity
error CometIsNotSupported(address comet)
```

_Reverts if the provided Comet contract is not supported._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the unsupported Comet contract. |

### MismatchedArrayLengths

```solidity
error MismatchedArrayLengths()
```

_Reverts if the length of the provided arrays do not match._

### AdapterAlreadyAllowed

```solidity
error AdapterAlreadyAllowed(address adapter)
```

_Reverts if the adapter is already allowed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the adapter that is already allowed. |

### CometAlreadyConfigured

```solidity
error CometAlreadyConfigured(address comet)
```

_Reverts if the Comet contract is already configured._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the Comet contract that is already configured. |

### InvalidCallbackHash

```solidity
error InvalidCallbackHash()
```

_Reverts if the callback data hash does not match the stored hash._

### DelegatecallFailed

```solidity
error DelegatecallFailed()
```

_Reverts if the delegatecall fails._

### BaseTokenMismatch

```solidity
error BaseTokenMismatch(address expected, address actual)
```

Reverts if the base token in the flash loan configuration does not match the Comet base token.

_Ensures compatibility between the flash loan token and the Comet market._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| expected | address | Address of the expected base token. |
| actual | address | Address of the actual base token provided. |

### AddressPairMismatch

```solidity
error AddressPairMismatch(address dai, address usds)
```

_Thrown when DAI and USDS addresses are inconsistent or identical when non-zero._

### MigrationExecuted

```solidity
event MigrationExecuted(address adapter, address user, address comet, uint256 flashAmount, uint256 flashFee)
```

Emitted when a migration is successfully executed.

_This event is emitted upon the successful completion of a migration, whether it involves a flash loan or not.
     It provides details about the adapter, user, target Comet market, and any flash loan parameters._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter used for the migration. |
| user | address | The address of the user initiating the migration. |
| comet | address | The address of the Compound III (Comet) market associated with the migration. |
| flashAmount | uint256 | The amount borrowed via the Uniswap V3 flash loan (if any). |
| flashFee | uint256 | The fee paid for the flash loan (if any). |

### AdapterAllowed

```solidity
event AdapterAllowed(address adapter)
```

Emitted when a protocol adapter is successfully registered.

_This event is emitted whenever a new adapter is added to the `allowedAdapters` mapping
     and the `_adapters` enumerable set. It indicates that the adapter is now authorized
     to handle migrations via the `migrate` function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter that was registered. |

### AdapterRemoved

```solidity
event AdapterRemoved(address adapter)
```

Emitted when a protocol adapter is removed from the list of allowed adapters.

_This event is emitted whenever an adapter is removed from the `allowedAdapters` mapping
     and the `_adapters` enumerable set. It indicates that the adapter is no longer authorized
     to handle migrations via the `migrate` function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter that was removed. |

### FlashDataConfigured

```solidity
event FlashDataConfigured(address comet, address liquidityPool, address baseToken)
```

Emitted when flash loan data is configured for a specific Compound III (Comet) market.

_This event is emitted whenever flash loan parameters are successfully set for a Comet market.
     It indicates that the specified Comet market is now configured to support flash loans._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | The address of the Comet contract for which the flash loan data is configured. |
| liquidityPool | address | The address of the Uniswap V3 pool used for the flash loan. |
| baseToken | address | The address of the token involved in the flash loan. |

### FlashDataRemoved

```solidity
event FlashDataRemoved(address comet)
```

Emitted when flash loan data is removed for a specific Compound III (Comet) market.

_This event is emitted whenever the flash loan configuration for a specific Comet market
     is deleted from the `_flashData` mapping. It indicates that the specified Comet market
     no longer supports flash loans for migrations._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | The address of the Comet contract whose flash loan configuration was removed. |

### validAdapter

```solidity
modifier validAdapter(address adapter)
```

Ensures that the provided adapter address is valid and registered.

_This modifier checks the `allowedAdapters` mapping to confirm that the adapter is registered
     and allowed to handle migrations. If the adapter is not registered, the transaction reverts.

Reverts:
- {InvalidAdapter} if the adapter is not currently allowed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter to validate. |

### validComet

```solidity
modifier validComet(address comet)
```

Ensures that the provided Comet address has a valid flash loan configuration.

_This modifier checks the `_flashData` mapping to confirm that the specified Comet contract
     has an associated flash loan configuration. If the configuration is missing, the transaction reverts.

Reverts:
- {CometIsNotSupported} if the `comet` address does not have an associated flash loan configuration._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | The address of the Comet contract to validate. |

### constructor

```solidity
constructor(address multisig, address[] adapters, address[] comets, struct MigratorV2.FlashData[] flashData, address dai, address usds) public
```

Initializes the MigratorV2 contract with the provided parameters.

_This constructor performs the following:
 - Sets the contract owner to the `multisig` address.
 - Registers protocol adapters provided in the `adapters` array.
 - Configures flash loan data for each corresponding Comet contract using the `flashData` array.
 - Validates that the `dai` and `usds` addresses are either both zero or both non-zero, and that they are not identical.
 - Ensures that the lengths of the `comets` and `flashData` arrays match.

Requirements:
- `multisig` must not be a zero address.
- `dai` and `usds` must either both be zero or both be non-zero, and they must not be identical.
- The lengths of the `comets` and `flashData` arrays must match.

Reverts:
- {InvalidZeroAddress} if any address within the inputs is zero.
- {MismatchedArrayLengths} if the lengths of `comets` and `flashData` arrays do not match.
- {AddressPairMismatch} if `dai` and `usds` are inconsistent or identical when non-zero._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| multisig | address | Address of the multisig wallet for contract ownership. |
| adapters | address[] | Array of protocol adapter addresses to register. |
| comets | address[] | Array of Comet contract addresses to support. |
| flashData | struct MigratorV2.FlashData[] | Array of flash loan configurations corresponding to each Comet contract. |
| dai | address | Address of the DAI token. |
| usds | address | Address of the USDS token. |

### migrate

```solidity
function migrate(address adapter, address comet, bytes migrationData, uint256 flashAmount) external
```

Initiates a user position migration into Compound III (Comet) via a registered protocol adapter.

_This function performs the following:
 1. Validates that the specified adapter is registered and that the target Comet contract is configured.
 2. Ensures the provided `migrationData` is not empty.
 3. Encodes and hashes the migration context for later verification during callback execution.
 4. If `flashAmount > 0`, initiates a flash loan from the configured Uniswap V3 pool by calling its `flash()` method.
 5. If `flashAmount == 0`, calls the adapter directly via `delegatecall` and passes encoded flashloanData with amount 0.
 6. If the delegatecall succeeds, emits the {MigrationExecuted} event with zero flash fee.
 7. Stores a callback hash only for the duration of the function execution to validate flash loan integrity._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter responsible for handling migration logic. |
| comet | address | The address of the target Compound III (Comet) market. |
| migrationData | bytes | ABI-encoded input containing migration strategy and user-specific data. |
| flashAmount | uint256 | The amount of tokens to borrow via Uniswap V3 flash loan. Use zero if no borrowing is needed. Requirements: - `adapter` must be registered in `allowedAdapters`. - `comet` must have associated flash loan configuration (`_flashData[comet]`). - `migrationData` must not be empty. Effects: - Stores a callback hash to validate flash loan integrity. - Either initiates a flash loan or directly calls the adapter logic depending on `flashAmount`. - Emits {MigrationExecuted} upon successful completion. Warning: - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts. Reverts: - {InvalidMigrationData} if `migrationData.length == 0`. - {InvalidAdapter} if the adapter is not registered. - {CometIsNotSupported} if flash data for `comet` is missing. - {DelegatecallFailed} if adapter delegatecall fails and returns an error payload. |

### uniswapV3FlashCallback

```solidity
function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes data) external
```

Executes migration logic during the Uniswap V3 flash loan callback.

_This function is invoked by the Uniswap V3 pool after a flash loan is issued.
It performs the following steps:
 1. Validates the callback integrity by comparing the `keccak256` hash of the provided `data`
    with the stored `_storedCallbackHash`.
 2. Decodes the migration context including the user address, adapter, comet, and migration input.
 3. Verifies that the caller is the expected Uniswap V3 pool associated with the target `comet`.
 4. Computes the repayment amount, including Uniswap's flash loan fee.
 5. Invokes the protocol adapter logic via `delegatecall`, passing the full context and encoded flash loan details.
 6. Emits the {MigrationExecuted} event if the adapter call succeeds._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| fee0 | uint256 | The fee owed for borrowing `token0` from the Uniswap pool. |
| fee1 | uint256 | The fee owed for borrowing `token1` from the Uniswap pool. |
| data | bytes | ABI-encoded callback payload containing:        - user: Address of the user initiating the migration.        - adapter: Address of the protocol adapter.        - comet: Address of the Comet market.        - migrationData: Adapter-specific migration data.        - flashAmount: The amount borrowed via flash loan. Requirements: - The function must be called by the exact Uniswap V3 liquidity pool configured for the `comet`. - The hash of `data` must match `_storedCallbackHash`. - The protocol adapter must successfully execute the migration via `delegatecall`. Effects: - Executes custom migration logic using the borrowed liquidity. - Emits {MigrationExecuted} with flash amount and computed fee. Reverts: - {InvalidCallbackHash} if the callback data does not match expectations. - {SenderNotUniswapPool} if the caller is not the configured Uniswap pool. - {DelegatecallFailed} or raw revert if adapter execution fails. |

### setAdapter

```solidity
function setAdapter(address adapter) external
```

Registers a new protocol adapter.

_This function adds the specified adapter to the `allowedAdapters` mapping and the `_adapters` enumerable set.
     Once registered, the adapter can be used for migrations via the `migrate` function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter to register. Requirements: - The caller must be the contract owner. - The `adapter` address must not be zero. - The `adapter` must not already be registered in `allowedAdapters`. Effects: - Marks the adapter as allowed in the `allowedAdapters` mapping. - Adds the adapter to the `_adapters` enumerable set. - Emits an {AdapterAllowed} event upon successful registration. Reverts: - {InvalidZeroAddress} if the `adapter` address is zero. - {AdapterAlreadyAllowed} if the `adapter` is already registered. |

### removeAdapter

```solidity
function removeAdapter(address adapter) external
```

Removes an existing protocol adapter from the list of allowed adapters.

_This function disables the specified adapter by marking it as disallowed in the `allowedAdapters` mapping
     and removes it from the `_adapters` enumerable set. Once removed, the adapter can no longer be used for migrations._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | The address of the protocol adapter to remove. Requirements: - The caller must be the contract owner. - The contract must be in a paused state. - The `adapter` must currently be registered in `allowedAdapters`. Effects: - Marks the adapter as disallowed in the `allowedAdapters` mapping. - Removes the adapter from the `_adapters` enumerable set. - Emits an {AdapterRemoved} event upon successful removal. Reverts: - {InvalidAdapter} if the adapter is not currently allowed. |

### setFlashData

```solidity
function setFlashData(address comet, struct MigratorV2.FlashData flashData) external
```

Removes the flash loan configuration for a specific Compound III (Comet) market.

_This function deletes the flash loan configuration associated with the given `comet` address
     from the `_flashData` mapping. Once removed, the specified Comet market will no longer support
     flash loans for migrations._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | The address of the Comet contract whose flash loan configuration is being removed. Requirements: - The caller must be the contract owner. - The `comet` address must have an existing flash loan configuration in `_flashData`. Effects: - Deletes the flash loan configuration for the specified `comet` from the `_flashData` mapping. - Emits a {FlashDataRemoved} event upon successful removal. Reverts: - {CometIsNotSupported} if the `comet` address does not have an associated flash loan configuration. |
| flashData | struct MigratorV2.FlashData |  |

### removeFlashData

```solidity
function removeFlashData(address comet) external
```

Removes flash loan configuration for a specific Comet contract.

_Ensures the Comet contract is currently supported before removal._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the Comet contract to remove flash data for. |

### pause

```solidity
function pause() public
```

Pauses all migration operations.

_This function pauses the contract, preventing any migration operations from being executed.
     It can only be called by the contract owner.

Requirements:
- The caller must be the contract owner.

Effects:
- Emits a {Paused} event upon successful execution._

### unpause

```solidity
function unpause() public
```

Resumes all migration operations after being paused.

_This function unpauses the contract, allowing migration operations to resume.
     It can only be called by the contract owner.

Requirements:
- The contract must be in a paused state.
- The caller must be the contract owner.

Effects:
- Emits an {Unpaused} event upon successful execution._

### getAdapters

```solidity
function getAdapters() external view returns (address[])
```

Retrieves the list of all registered protocol adapters.

_This function uses the `EnumerableSet` library to efficiently retrieve the addresses of all
     protocol adapters currently registered in the `_adapters` set._

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address[] | An array of addresses representing all registered protocol adapters. Usage: - This function can be called to verify which adapters are currently allowed for migrations. |

### getFlashData

```solidity
function getFlashData(address comet) external view returns (struct MigratorV2.FlashData)
```

Retrieves the flash loan configuration for a specific Compound III (Comet) market.

_This function allows external callers to fetch the flash loan configuration for a specific Comet market.
     The configuration must have been previously set using the `_setFlashData` function.

Requirements:
- The `comet` address must have an existing flash loan configuration in `_flashData`.

Usage:
- Can be used to verify the flash loan setup for a specific Comet market before initiating a migration._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | The address of the Comet contract whose flash loan configuration is being retrieved. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | struct MigratorV2.FlashData | The `FlashData` struct containing the following details:         - `liquidityPool`: Address of the Uniswap V3 pool used for the flash loan.         - `baseToken`: Address of the token involved in the flash loan.         - `isToken0`: Boolean indicating whether the `baseToken` is token0 in the Uniswap V3 liquidity pool. |

### getEncodedDaiToUsdsConversionPath

```solidity
function getEncodedDaiToUsdsConversionPath() external view returns (bytes)
```

Retrieves the encoded Uniswap V3 swap path for converting DAI to USDS.

_This function returns the ABI-encoded path used for Uniswap V3 swaps, specifying the sequence of tokens
     involved in the conversion from DAI to USDS. The path is constructed using the `abi.encodePacked` function._

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes | The ABI-encoded swap path for converting DAI to USDS. Usage: - This path can be used as input for Uniswap V3 swap functions to perform the DAI ⇄ USDS conversion. Requirements: - The `DAI` and `USDS` addresses must be correctly initialized during contract deployment. |

### getEncodedUsdsToDaiConversionPath

```solidity
function getEncodedUsdsToDaiConversionPath() external view returns (bytes)
```

Retrieves the encoded Uniswap V3 swap path for converting USDS to DAI.

_This function returns the ABI-encoded path used for Uniswap V3 swaps, specifying the sequence of tokens
     involved in the conversion from USDS to DAI. The path is constructed using the `abi.encodePacked` function._

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bytes | The ABI-encoded swap path for converting USDS to DAI. Usage: - This path can be used as input for Uniswap V3 swap functions to perform the USDS ⇄ DAI conversion. Requirements: - The `USDS` and `DAI` addresses must be correctly initialized during contract deployment. |

