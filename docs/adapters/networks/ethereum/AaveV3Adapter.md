# Solidity API

## AaveV3Adapter

Adapter contract to migrate positions from Aave V3 to Compound III (Comet)

### DeploymentParams

Initializes the AaveV3Adapter contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
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
```

### AaveV3Position

Structure representing the user's position in Aave V3

_borrows Array of borrow positions to repay
collateral Array of collateral positions to migrate_

```solidity
struct AaveV3Position {
  struct AaveV3Adapter.AaveV3Borrow[] borrows;
  struct AaveV3Adapter.AaveV3Collateral[] collaterals;
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
  struct SwapModule.SwapInputLimitParams swapParams;
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
  struct SwapModule.SwapOutputLimitParams swapParams;
}
```

### INTEREST_RATE_MODE

```solidity
uint256 INTEREST_RATE_MODE
```

Interest rate mode for variable-rate borrowings in Aave V3 (2 represents variable rate)

### IS_FULL_MIGRATION

```solidity
bool IS_FULL_MIGRATION
```

Boolean indicating whether the migration is a full migration

### LENDING_POOL

```solidity
contract IAavePool LENDING_POOL
```

Aave V3 Lending Pool contract address

### DATA_PROVIDER

```solidity
contract IAavePoolDataProvider DATA_PROVIDER
```

Aave V3 Data Provider contract address

### DebtNotCleared

```solidity
error DebtNotCleared(address aToken)
```

_Reverts if the debt for a specific token has not been successfully cleared_

### constructor

```solidity
constructor(struct AaveV3Adapter.DeploymentParams deploymentParams) public
```

Initializes the AaveV3Adapter contract

_Reverts if any of the provided addresses are zero_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| deploymentParams | struct AaveV3Adapter.DeploymentParams | Struct containing the deployment parameters: - uniswapRouter Address of the Uniswap V3 SwapRouter contract - daiUsdsConverter Address of the DAI to USDS converter contract - dai Address of the DAI token - usds Address of the USDS token - wrappedNativeToken Address of the wrapped native token (e.g., WETH) - aaveLendingPool Address of the Aave V3 Lending Pool contract - aaveDataProvider Address of the Aave V3 Data Provider contract |

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
function repayBorrow(address user, struct AaveV3Adapter.AaveV3Borrow borrow) internal
```

Repays a borrow position for the user on Aave V3

_May perform a swap to obtain the necessary tokens for repayment_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose borrow is being repaid |
| borrow | struct AaveV3Adapter.AaveV3Borrow | The borrow position details |

### migrateCollateral

```solidity
function migrateCollateral(address user, address comet, struct AaveV3Adapter.AaveV3Collateral collateral) internal
```

Migrates a user's collateral position from Aave V3 to Compound III

_May perform a swap to obtain the migration tokens_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose collateral is being migrated |
| comet | address | Address of the Compound III (Comet) contract |
| collateral | struct AaveV3Adapter.AaveV3Collateral | The collateral position details |

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

