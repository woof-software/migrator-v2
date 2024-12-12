# Solidity API

## MigratorV2

This contract facilitates migration of user positions between protocols using flash loans from Uniswap V3.

_The contract interacts with Uniswap V3 for flash loans and uses protocol adapters to execute migrations._

### FlashData

_Struct to hold flash loan configuration details._

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

### allowedAdapters

```solidity
mapping(address => bool) allowedAdapters
```

_Mapping to track whether an address is a registered protocol adapter._

### InvalidZeroAddress

```solidity
error InvalidZeroAddress()
```

_Reverts if any address parameter is zero._

### InvalidMigrationData

```solidity
error InvalidMigrationData()
```

_Reverts if migration data is empty._

### InvalidFlashAmount

```solidity
error InvalidFlashAmount()
```

_Reverts if the flash loan amount is zero._

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

### ERC20TransferFailure

```solidity
error ERC20TransferFailure()
```

_Reverts if the ERC-20 transfer fails._

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

### AdapterExecuted

```solidity
event AdapterExecuted(address adapter, address user, uint256 flashAmount, uint256 flashAmountWithFee)
```

Emitted when an adapter executes a migration.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the protocol adapter used for migration. |
| user | address | Address of the user initiating the migration. |
| flashAmount | uint256 | Amount borrowed in the flash loan. |
| flashAmountWithFee | uint256 | Total amount repaid to the Uniswap pool (borrowed amount + fee). |

### validAdapter

```solidity
modifier validAdapter(address adapter)
```

Ensures that the provided adapter address is valid.

_Reverts with {InvalidAdapter} if the adapter is not allowed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the protocol adapter to validate. |

### validComet

```solidity
modifier validComet(address comet)
```

Ensures that the provided Comet address is supported.

_Reverts with {CometIsNotSupported} if the Comet contract is not supported._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the Comet contract to validate. |

### constructor

```solidity
constructor(address multisig, address[] adapters, address[] comets, struct MigratorV2.FlashData[] flashData) public
```

Initializes the contract with the provided parameters.

_This constructor:
 - Sets the contract owner to the `multisig` address.
 - Registers protocol adapters provided in the `adapters` array.
 - Configures flash loan data for each corresponding Comet contract using the `flashData` array.
 - Pauses the contract if any of the input arrays are empty.
Reverts with:
 - {InvalidZeroAddress} if any address within the inputs is zero.
 - {MismatchedArrayLengths} if the length of `comets` and `flashData` arrays do not match._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| multisig | address | Address of the multisig wallet for contract ownership. |
| adapters | address[] | Array of protocol adapter addresses to register. |
| comets | address[] | Array of Comet contract addresses to support. |
| flashData | struct MigratorV2.FlashData[] | Array of flash loan configurations corresponding to each Comet contract. |

### receive

```solidity
receive() external payable
```

Allows the contract to receive the native token.

### migrate

```solidity
function migrate(address adapter, address comet, bytes migrationData, uint256 flashAmount) external
```

Initiates the migration process using a flash loan from Uniswap V3.

_Validates the adapter and Comet contract, ensures the flash amount and migration data are valid.
Encodes the migration data and initiates a flash loan from Uniswap V3.
Reverts with {InvalidFlashAmount} if the flash loan amount is zero.
Reverts with {InvalidMigrationData} if the migration data is empty._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the protocol adapter that handles the migration logic. |
| comet | address | Address of the Comet contract associated with the migration. |
| migrationData | bytes | Encoded data containing migration details, specific to the adapter. |
| flashAmount | uint256 | Amount of tokens to borrow in the flash loan. |

### uniswapV3FlashCallback

```solidity
function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes data) external
```

Callback function triggered by Uniswap V3 after a flash loan is initiated.

_Validates the caller and decodes the callback data.
Invokes the adapter to execute the migration logic and ensures the flash loan is repaid._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| fee0 | uint256 | Fee for borrowing token0 in the flash loan. |
| fee1 | uint256 | Fee for borrowing token1 in the flash loan. |
| data | bytes | Encoded data passed during the flash loan initiation, including migration details. |

### setAdapter

```solidity
function setAdapter(address adapter) external
```

Registers a new protocol adapter.

_Ensures that the adapter address is valid and not already registered.
Reverts with {InvalidZeroAddress} if the adapter address is zero._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the adapter to register. |

### removeAdapter

```solidity
function removeAdapter(address adapter) external
```

Removes an existing protocol adapter.

_Ensures that the adapter is currently registered before removal._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| adapter | address | Address of the adapter to remove. |

### setFlashData

```solidity
function setFlashData(address comet, struct MigratorV2.FlashData flashData) external
```

Sets flash loan configuration for a specific Comet contract.

_Validates the flashData parameters and updates the mapping.
Reverts with {InvalidZeroAddress} if any address in the flashData is zero._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the Comet contract. |
| flashData | struct MigratorV2.FlashData | Struct containing flash loan configuration details (liquidity pool, base token, token0 status). |

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

_Can only be called by the contract owner.
Emits a {Paused} event when successful._

### unpause

```solidity
function unpause() public
```

Resumes all migration operations after being paused.

_Can only be called by the contract owner.
Emits an {Unpaused} event when successful._

### getAdapters

```solidity
function getAdapters() external view returns (address[])
```

Retrieves the list of registered protocol adapters.

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address[] | Array of all registered protocol adapter addresses. |

