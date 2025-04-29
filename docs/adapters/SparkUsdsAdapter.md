# Solidity API

## SparkUsdsAdapter

Adapter contract for migrating user positions from Spark Protocol to Compound III (Comet), with support for USDS-based markets.

_This contract implements the `IProtocolAdapter` interface and integrates the `SwapModule` and `ConvertModule`
     to facilitate seamless migration of debt and collateral positions. It supports token swaps via Uniswap V3
     and stablecoin conversions (DAI ⇄ USDS) for USDS-based Compound III markets.

Core Responsibilities:
- Decodes user positions (borrows and collaterals) from encoded calldata.
- Handles repayment of variable-rate debt positions in Spark Protocol.
- Executes token swaps or stablecoin conversions as needed for repayment or migration.
- Withdraws and optionally converts Spark collateral tokens before supplying them to Compound III.
- Supports Uniswap-based flash loan repayments with fallback logic to pull funds from the user's Comet balance.

USDS-Specific Logic:
- Converts DAI to USDS when migrating to USDS-based Comet markets.
- Converts USDS to DAI when repaying flash loans borrowed in DAI for USDS Comet markets.
- Automatically detects when stablecoin conversion is required based on swap paths and base tokens.

Key Components:
- `executeMigration`: Entry point for coordinating the full migration flow.
- `_repayBorrow`: Handles repayment of Spark debt, optionally performing swaps or conversions.
- `_migrateCollateral`: Withdraws and optionally converts Spark collateral into Comet-compatible tokens.
- `_repayFlashloan`: Repays flash loans using contract balance or by withdrawing from the user's Comet account.
- `_isDebtCleared`: Verifies whether a specific Spark debt position has been fully repaid.

Constructor Configuration:
- Accepts Uniswap router, stablecoin converter, token addresses, Spark contracts, and a full migration flag.
- Stores all parameters as immutable for gas efficiency and safety.

Requirements:
- User must approve this contract to transfer relevant spTokens and debtTokens.
- Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
- Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).

Limitations:
- Supports only variable-rate Spark debt (interestRateMode = 2).
- Only DAI ⇄ USDS conversions are supported for USDS-based Comet markets.
- Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`._

### DeploymentParams

Struct for initializing deployment parameters of the adapter.

_This struct encapsulates all the necessary parameters required to deploy the `SparkUsdsAdapter` contract.
     It ensures that the adapter is properly configured with the required external contract addresses and settings._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct DeploymentParams {
  address uniswapRouter;
  address daiUsdsConverter;
  address dai;
  address usds;
  address sparkLendingPool;
  address sparkDataProvider;
  bool isFullMigration;
  bool useSwapRouter02;
}
```

### SparkPosition

Struct representing a user's full position in Spark Protocol.

_This struct encapsulates all the necessary information about a user's Spark position,
     enabling seamless migration of both debt and collateral to Compound III (Comet)._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct SparkPosition {
  struct SparkUsdsAdapter.SparkBorrow[] borrows;
  struct SparkUsdsAdapter.SparkCollateral[] collateral;
}
```

### SparkBorrow

Struct representing a single borrow position to repay in Spark Protocol.

_This struct is used to define the details of a borrow position, including the debt token,
     the amount to repay, and optional swap parameters for acquiring the repayment token._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct SparkBorrow {
  address debtToken;
  uint256 amount;
  struct SwapModule.SwapInputLimitParams swapParams;
}
```

### SparkCollateral

Struct representing a single collateral position to migrate from Spark Protocol to Compound III (Comet).

_This struct is used to define the details of a collateral position, including the token to migrate,
     the amount to migrate, and optional swap parameters for converting the collateral into a token
     compatible with the target Compound III market._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

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

Interest rate mode for variable-rate borrowings in Spark Protocol.

_This constant is set to `2`, which represents the variable interest rate mode in Spark.
     It is used when repaying borrow positions in the Spark Lending Pool._

### IS_FULL_MIGRATION

```solidity
bool IS_FULL_MIGRATION
```

Boolean indicating whether the migration is a full migration.

_This immutable variable determines if the migration process requires all debt positions
     to be fully cleared. If set to `true`, the contract ensures that all outstanding debt
     is repaid during the migration process. It is initialized during the deployment of the
     `SparkUsdsAdapter` contract._

### LENDING_POOL

```solidity
contract ISparkPool LENDING_POOL
```

Spark Lending Pool contract address.

_This immutable variable holds the address of the Spark Lending Pool, which is used to perform
     operations such as withdrawing collateral and repaying debt. It is initialized during the deployment
     of the `SparkUsdsAdapter` contract._

### DATA_PROVIDER

```solidity
contract ISparkPoolDataProvider DATA_PROVIDER
```

Spark Data Provider contract address.

_This immutable variable holds the address of the Spark Data Provider, which is used to fetch
     user reserve data, including debt and collateral information. It is initialized during the deployment
     of the `SparkUsdsAdapter` contract._

### DebtNotCleared

```solidity
error DebtNotCleared(address spToken)
```

This error is triggered during a full migration when the user's debt for a specific asset
        in Spark has not been fully repaid after the repayment process.

_Reverts if the debt for a specific token has not been successfully cleared._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| spToken | address | The address of the Spark spToken associated with the uncleared debt. |

### constructor

```solidity
constructor(struct SparkUsdsAdapter.DeploymentParams deploymentParams) public
```

Initializes the SparkUsdsAdapter contract with deployment parameters.

_The constructor initializes the `SwapModule` and `ConvertModule` with the provided Uniswap router
     and stablecoin converter addresses. It also validates that the Spark Lending Pool and Data Provider
     addresses are non-zero. All parameters are stored as immutable for gas efficiency and safety.

Requirements:
- `sparkLendingPool` and `sparkDataProvider` must not be zero addresses.

Warning:
- If `daiUsdsConverter`, `dai`, or `usds` are set to zero addresses, USDS-specific logic (e.g., DAI ⇄ USDS conversions)
  will not be supported. In this case, only standard token swaps will be available for migration.

Reverts:
- {InvalidZeroAddress} if `sparkLendingPool` or `sparkDataProvider` is a zero address._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| deploymentParams | struct SparkUsdsAdapter.DeploymentParams | Struct containing the following deployment parameters:        - `uniswapRouter`: Address of the Uniswap V3 SwapRouter contract.        - `daiUsdsConverter`: Address of the DAI ⇄ USDS converter contract (optional, can be zero address).        - `dai`: Address of the DAI token (optional, can be zero address).        - `usds`: Address of the USDS token (optional, can be zero address).        - `sparkLendingPool`: Address of the Spark Lending Pool contract.        - `sparkDataProvider`: Address of the Spark Data Provider contract.        - `isFullMigration`: Boolean flag indicating whether the migration requires all debt to be cleared.        - `useSwapRouter02`: Boolean flag indicating whether to use Uniswap V3 SwapRouter02. |

### executeMigration

```solidity
function executeMigration(address user, address comet, bytes migrationData, bytes flashloanData, uint256 preBaseAssetBalance) external
```

Executes the migration of a user's full or partial position from Spark Protocol to Compound III (Comet).

_This function performs the following steps:
 1. Decodes the encoded `migrationData` into a `SparkPosition` struct that includes the user's
    outstanding borrow positions and collateral balances in Spark.
 2. Iterates over each borrow position and invokes `_repayBorrow`, which handles repayment logic,
    including token swaps or stablecoin conversions if necessary.
 3. Iterates over each collateral item and calls `_migrateCollateral` to withdraw the user's assets
    from Spark and deposit them into Compound III. This step may involve:
    - Converting tokens (e.g., DAI → USDS),
    - Performing Uniswap V3 swaps.
 4. If `flashloanData` is provided, the function invokes `_repayFlashloan` to settle the flash loan debt.
    Repayment can happen from contract balance or by withdrawing the needed amount from the user’s
    balance in Compound III._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose Spark position is being migrated. |
| comet | address | The address of the target Compound III (Comet) market to receive the migrated assets. |
| migrationData | bytes | ABI-encoded `SparkPosition` struct containing:        - An array of `SparkBorrow` items to repay.        - An array of `SparkCollateral` items to migrate. |
| flashloanData | bytes | ABI-encoded data used to repay a Uniswap V3 flash loan if one was taken.        Pass an empty bytes value if no flash loan is used (e.g., for collateral-only migrations). |
| preBaseAssetBalance | uint256 | The contract's base token balance before the migration process begins. Requirements: - The user must approve this contract to transfer their `spTokens` and act on their behalf in Spark. - The `migrationData` must be correctly encoded and represent valid Spark positions. - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment. Warning: - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts. Reverts: - If any borrow repayment, collateral migration, or flash loan repayment fails. - If the migration process encounters invalid swap paths or insufficient allowances. |

### _repayFlashloan

```solidity
function _repayFlashloan(address user, address comet, bytes flashloanData, uint256 preBaseAssetBalance) internal
```

Repays a flash loan obtained from a Uniswap V3 liquidity pool.

_This function ensures that the borrowed flash loan amount, including its associated fee,
     is fully repaid to the originating liquidity pool. If the contract's balance of the
     `flashBaseToken` is insufficient, it attempts to withdraw the shortfall from the user's
     Compound III (Comet) account. If the flash loan was taken in DAI but the Comet market uses
     USDS as its base token, the contract first withdraws USDS and converts it to DAI before repayment.

Steps performed:
1. Decodes the `flashloanData` to extract the flash loan pool, token, and repayment amount.
2. Checks the contract's current balance of the flash loan token and calculates any shortfall.
3. If a shortfall exists:
   - Calculates the amount to withdraw from the user's Comet account.
   - Withdraws the required amount from the user's Comet account.
   - Converts USDS to DAI if necessary for repayment.
4. Transfers the full repayment amount (including fees) back to the flash loan pool.
5. Supplies any residual base token balance back to the user's Comet account._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose Compound III (Comet) balance may be used to cover the shortfall. |
| comet | address | The address of the Compound III (Comet) market associated with the user's position. |
| flashloanData | bytes | ABI-encoded tuple containing:        - `flashLiquidityPool` (address): The Uniswap V3 pool that provided the flash loan.        - `flashBaseToken` (IERC20): The token borrowed via the flash loan.        - `flashAmountWithFee` (uint256): The total amount to repay, including fees. |
| preBaseAssetBalance | uint256 | The contract's base token balance before the flash loan was taken. Requirements: - The contract must ensure full repayment of `flashAmountWithFee` in `flashBaseToken`. - If the contract's balance is insufficient, it must withdraw the difference from the user's Comet account. - If the repayment token is DAI and the market uses USDS, conversion must occur prior to transfer. Effects: - May withdraw assets from the user’s Compound III account using `withdrawFrom()`. - May trigger `_convertUsdsToDai()` if conversion is necessary. - Ends with `safeTransfer` to the liquidity pool, repaying the flash loan. |

### _calculateWithdrawAmount

```solidity
function _calculateWithdrawAmount(address comet, address user, uint256 ownBaseTokenBalance, uint256 repayFlashloanAmount) internal view returns (uint256 withdrawAmount)
```

Calculates the amount of tokens to withdraw from the user's Compound III (Comet) account
        to cover a flash loan repayment shortfall.

_This function determines the optimal withdrawal amount based on the user's current Comet balances,
     borrow limits, and the flash loan repayment requirements. It ensures that the user maintains the
     minimum borrow balance (`baseBorrowMin`) required by Comet after the transaction._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| comet | address | Address of the Compound III (Comet) contract. |
| user | address | Address of the user whose Comet account is being accessed. |
| ownBaseTokenBalance | uint256 | Current balance of the base token held by the contract. |
| repayFlashloanAmount | uint256 | Total amount required to repay the flash loan, including fees. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| withdrawAmount | uint256 | The amount of tokens to withdraw from the user's Comet account. Logic: - If the user's Comet base token balance is sufficient to cover the shortfall, withdraw only the shortfall amount. - If the user's projected borrow balance after the transaction meets or exceeds `baseBorrowMin`, withdraw the shortfall. - If the user's projected borrow balance is below `baseBorrowMin`, calculate the additional amount needed to meet the minimum. - If the user has no debt and the required amount is less than `baseBorrowMin`, withdraw the minimum borrow amount. Requirements: - The user must have sufficient base token balance or borrowing capacity in their Comet account. Reverts: - This function does not revert directly but relies on the caller to handle insufficient balances or borrowing capacity. |

### _repayBorrow

```solidity
function _repayBorrow(address user, struct SparkUsdsAdapter.SparkBorrow borrow) internal
```

Repays a borrow position held by the user on the Spark protocol.

_This function handles the repayment of a variable-rate debt position in Spark. It supports
flexible repayment strategies, including full or partial repayment. If the repayment token
(debtToken) is not already available, the function performs a swap or conversion to acquire it.

Repayment logic:
- If `borrow.amount == type(uint256).max`, the function repays the full outstanding debt.
- If `swapParams.path` is provided, the function:
    - Converts USDS to DAI using `_convertUsdsToDai()` if required.
    - Converts DAI to USDS using `_convertDaiToUsds()` if required.
    - Executes an exact-output swap on Uniswap V3 to acquire the required debt token.
- After acquiring the repayment token, the function approves the Spark Lending Pool to spend it
  and calls `repay()` on behalf of the user.

If the migration mode is full (`IS_FULL_MIGRATION`), the function verifies that the debt has been
fully cleared using `_isDebtCleared()` and reverts with `DebtNotCleared()` if any residual debt remains._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose Spark borrow position is being repaid. |
| borrow | struct SparkUsdsAdapter.SparkBorrow | Struct containing:        - `debtToken`: Address of the Spark variable debt token to repay.        - `amount`: The amount of debt to repay. Use `type(uint256).max` for full repayment.        - `swapParams`: Parameters to define token swap logic (optional). Requirements: - If a swap is required, `swapParams.path` must be valid and match the expected input/output tokens. - The user must hold sufficient Spark debt and allow repayment on their behalf. - If in full migration mode, the debt must be fully cleared after repayment. Effects: - Performs token conversion or swap if necessary. - Transfers repayment tokens to the Spark Lending Pool. - Verifies debt clearance post-repayment if `IS_FULL_MIGRATION` is set. Reverts: - If the debt is not fully cleared during a full migration. - If token transfers, swaps, or approvals fail. |

### _migrateCollateral

```solidity
function _migrateCollateral(address user, address comet, struct SparkUsdsAdapter.SparkCollateral collateral) internal
```

Migrates a user's collateral position from the Spark protocol to Compound III (Comet).

_This function withdraws the specified collateral from Spark, optionally swaps it to a
supported token in the Comet market, and deposits it into the target Compound III market
on behalf of the user.

Migration strategies supported:
- Full or partial migration of collateral.
- Direct supply of the underlying asset if no swap is needed.
- Token swap using Uniswap V3 for cases when the Spark collateral must be converted
  to a supported token in Compound III.
- USDS migration via DAI proxy mechanism:
    - If the swap result is DAI and the Compound market uses USDS as base token,
      DAI is converted to USDS before supply._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose collateral is being migrated. |
| comet | address | The address of the Compound III (Comet) market to which the collateral is supplied. |
| collateral | struct SparkUsdsAdapter.SparkCollateral | Struct describing the Spark collateral position:        - `spToken`: The Spark spToken address representing the collateral.        - `amount`: The amount of collateral to migrate (can be `type(uint256).max` for full).        - `swapParams`: Optional parameters defining swap path and limits. Requirements: - The user must approve the contract to transfer their `spToken`. - If `swapParams.path.length > 0`, it must be valid and executable. - For DAI → USDS conversion, `ConvertModule` must be configured with valid converter. Effects: - Transfers and withdraws collateral from Spark. - Optionally swaps/unwraps/wraps/convert tokens to match Comet's requirements. - Supplies resulting asset to Comet market on behalf of the user. |

### _isDebtCleared

```solidity
function _isDebtCleared(address user, contract IERC20 asset) internal view returns (bool isCleared)
```

Checks whether the user's debt position for a specific asset in Spark is fully repaid.

_Queries the Spark Data Provider to retrieve the user's reserve data for the specified asset.
     Extracts the current variable debt amount and returns `true` only if the debt is zero.
     This method is typically used during full migrations to ensure no residual debt remains._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose debt status is being checked. |
| asset | contract IERC20 | The address of the underlying asset in Spark (e.g., DAI, USDC, etc.). |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| isCleared | bool | A boolean value indicating whether the variable debt for the specified asset is fully cleared.         Returns `true` if the debt is zero, otherwise `false`. |

