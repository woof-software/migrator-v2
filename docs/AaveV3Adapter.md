# Solidity API

## AaveV3Adapter

Adapter contract to migrate positions from Aave V3 to Compound III (Comet)

### AaveV3Position

Structure representing the user's position in Aave V3

_borrows Array of borrow positions to repay
collateral Array of collateral positions to migrate
swaps Array of swap parameters corresponding to each borrow_

```solidity
struct AaveV3Position {
  struct AaveV3Adapter.AaveV3Borrow[] borrows;
  struct AaveV3Adapter.AaveV3Collateral[] collateral;
  struct SwapModule.Swap[] swaps;
}
```

### AaveV3Borrow

Structure representing an individual borrow position in Aave V3

_aDebtToken Address of the Aave V3 variable debt token
amount Amount of debt to repay; use `type(uint256).max` to repay all_

```solidity
struct AaveV3Borrow {
  address aDebtToken;
  uint256 amount;
}
```

### AaveV3Collateral

Structure representing an individual collateral position in Aave V3

_aToken Address of the Aave V3 aToken (collateral token)
amount Amount of collateral to migrate; use `type(uint256).max` to migrate all_

```solidity
struct AaveV3Collateral {
  address aToken;
  uint256 amount;
}
```

### INTEREST_RATE_MODE

```solidity
uint256 INTEREST_RATE_MODE
```

Interest rate mode for variable-rate borrowings in Aave V3 (2 represents variable rate)

### LENDING_POOL

```solidity
contract IAaveLendingPool LENDING_POOL
```

Aave V3 Lending Pool contract address

### DebtNotCleared

```solidity
error DebtNotCleared(address aToken)
```

_Reverts if the debt for a specific token has not been successfully cleared_

### constructor

```solidity
constructor(address _uniswapRouter, address _daiUsdsConverter, address _dai, address _usds, address _wrappedNativeToken, address _aaveLendingPool) public
```

Initializes the AaveV3Adapter contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _uniswapRouter | address | Address of the Uniswap V3 SwapRouter contract |
| _daiUsdsConverter | address | Address of the DAI to USDS converter contract |
| _dai | address | Address of the DAI token |
| _usds | address | Address of the USDS token |
| _wrappedNativeToken | address | Address of the wrapped native token (e.g., WETH) |
| _aaveLendingPool | address | Address of the Aave V3 Lending Pool contract |

### executeMigration

```solidity
function executeMigration(address user, address comet, bytes migrationData) external
```

Executes the migration of a user's Aave V3 position to Compound III

_This function decodes the migration data and processes borrows and collateral_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose position is being migrated |
| comet | address | Address of the Compound III (Comet) contract |
| migrationData | bytes | Encoded data containing the user's Aave V3 position details |

### repayBorrow

```solidity
function repayBorrow(address user, struct AaveV3Adapter.AaveV3Borrow borrow, struct SwapModule.Swap swap) internal
```

Repays a borrow position for the user on Aave V3

_May perform a swap to obtain the necessary tokens for repayment_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose borrow is being repaid |
| borrow | struct AaveV3Adapter.AaveV3Borrow | The borrow position details |
| swap | struct SwapModule.Swap | Swap parameters to obtain the repayment tokens, if needed |

### migrateCollateral

```solidity
function migrateCollateral(address user, address comet, struct AaveV3Adapter.AaveV3Collateral collateral, struct SwapModule.Swap swap) internal
```

Migrates a user's collateral position from Aave V3 to Compound III

_May perform a swap to obtain the migration tokens_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose collateral is being migrated |
| comet | address | Address of the Compound III (Comet) contract |
| collateral | struct AaveV3Adapter.AaveV3Collateral | The collateral position details |
| swap | struct SwapModule.Swap | Swap parameters to obtain the migration tokens, if needed |

### _isDebtCleared

```solidity
function _isDebtCleared(address user, address asset) internal view returns (bool isCleared)
```

Checks if the debt for a specific token has been successfully closed.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user. |
| asset | address | Address of the token for which the debt needs to be verified. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| isCleared | bool | Boolean indicating whether the debt is cleared. |

