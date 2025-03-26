# Solidity API

## SparkAdapter

Adapter contract to migrate positions from Spark to Compound III (Comet)

### DeploymentParams

Structure representing the deployment parameters for the SparkAdapter contract

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
  address sparkLendingPool;
  address sparkDataProvider;
  bool isFullMigration;
}
```

### SparkPosition

Structure representing the user's position in Spark

_borrows Array of borrow positions to repay
collateral Array of collateral positions to migrate_

```solidity
struct SparkPosition {
  struct SparkAdapter.SparkBorrow[] borrows;
  struct SparkAdapter.SparkCollateral[] collateral;
}
```

### SparkBorrow

Structure representing an individual borrow position in Spark

_spDebtToken Address of the Spark variable debt token
amount Amount of debt to repay; use `type(uint256).max` to repay all_

```solidity
struct SparkBorrow {
  address spDebtToken;
  uint256 amount;
  struct SwapModule.SwapInputLimitParams swapParams;
}
```

### SparkCollateral

Structure representing an individual collateral position in Spark

_spToken Address of the Spark spToken (collateral token)
amount Amount of collateral to migrate; use `type(uint256).max` to migrate all_

```solidity
struct SparkCollateral {
  address spToken;
  uint256 amount;
  struct SwapModule.SwapOutputLimitParams swapParams;
}
```

### INTEREST_RATE_MODE

```solidity
uint256 INTEREST_RATE_MODE
```

Interest rate mode for variable-rate borrowings in Spark (2 represents variable rate)

### IS_FULL_MIGRATION

```solidity
bool IS_FULL_MIGRATION
```

Boolean indicating whether the migration is a full migration

### LENDING_POOL

```solidity
contract ISparkPool LENDING_POOL
```

Spark Lending Pool contract address

### DATA_PROVIDER

```solidity
contract ISparkPoolDataProvider DATA_PROVIDER
```

Spark Data Provider contract address

### DebtNotCleared

```solidity
error DebtNotCleared(address spToken)
```

_Reverts if the debt for a specific token has not been successfully cleared_

### constructor

```solidity
constructor(struct SparkAdapter.DeploymentParams deploymentParams) public
```

Initializes the SparkAdapter contract

_Reverts if any of the provided addresses are zero_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| deploymentParams | struct SparkAdapter.DeploymentParams | Deployment parameters for the SparkAdapter contract: - uniswapRouter Address of the Uniswap V3 SwapRouter contract - daiUsdsConverter Address of the DAI to USDS converter contract - dai Address of the DAI token - usds Address of the USDS token - wrappedNativeToken Address of the wrapped native token (e.g., WETH) - sparkLendingPool Address of the Spark Lending Pool contract - sparkDataProvider Address of the Spark Data Provider contract - isFullMigration Boolean indicating whether the migration is full or partial |

### executeMigration

```solidity
function executeMigration(address user, address comet, bytes migrationData) external
```

Executes the migration of a user's Spark position to Compound III

_This function decodes the migration data and processes borrows and collateral_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose position is being migrated |
| comet | address | Address of the Compound III (Comet) contract |
| migrationData | bytes | Encoded data containing the user's Spark position details |

### repayBorrow

```solidity
function repayBorrow(address user, struct SparkAdapter.SparkBorrow borrow) internal
```

Repays a borrow position for the user on Spark

_May perform a swap to obtain the necessary tokens for repayment_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose borrow is being repaid |
| borrow | struct SparkAdapter.SparkBorrow | The borrow position details |

### migrateCollateral

```solidity
function migrateCollateral(address user, address comet, struct SparkAdapter.SparkCollateral collateral) internal
```

Migrates a user's collateral position from Spark to Compound III

_May perform a swap to obtain the migration tokens_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | Address of the user whose collateral is being migrated |
| comet | address | Address of the Compound III (Comet) contract |
| collateral | struct SparkAdapter.SparkCollateral | The collateral position details |

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

