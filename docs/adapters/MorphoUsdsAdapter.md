# Solidity API

## MorphoUsdsAdapter

Adapter contract for migrating user positions from Morpho to Compound III (Comet), with support for USDS-based markets.

_This contract implements the `IProtocolAdapter` interface and integrates the `SwapModule` and `ConvertModule`
     to facilitate seamless migration of debt and collateral positions. It supports token swaps via Uniswap V3
     and stablecoin conversions (DAI ⇄ USDS) for USDS-based Compound III markets.

Core Responsibilities:
- Decodes user positions (borrows and collaterals) from encoded calldata.
- Handles repayment of variable-rate debt positions in Morpho.
- Executes token swaps or stablecoin conversions as needed for repayment or migration.
- Withdraws and optionally converts Morpho collateral tokens before supplying them to Compound III.
- Supports Uniswap-based flash loan repayments with fallback logic to pull funds from the user's Comet balance.

USDS-Specific Logic:
- Converts DAI to USDS when migrating to USDS-based Comet markets.
- Converts USDS to DAI when repaying flash loans borrowed in DAI for USDS Comet markets.
- Automatically detects when stablecoin conversion is required based on swap paths and base tokens.

Key Components:
- `executeMigration`: Entry point for coordinating the full migration flow.
- `_repayBorrow`: Handles repayment of Morpho debt, optionally performing swaps or conversions.
- `_migrateCollateral`: Withdraws and optionally converts Morpho collateral into Comet-compatible tokens.
- `_repayFlashloan`: Repays flash loans using contract balance or by withdrawing from the user's Comet account.
- `_isDebtCleared`: Verifies whether a specific Morpho debt position has been fully repaid.

Constructor Configuration:
- Accepts Uniswap router, stablecoin converter, token addresses, Morpho contracts, and a full migration flag.
- Stores all parameters as immutable for gas efficiency and safety.

Requirements:
- User must approve this contract to transfer relevant collateral and debt positions.
- Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
- Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).

Limitations:
- Supports only variable-rate Morpho debt.
- Only DAI ⇄ USDS conversions are supported for USDS-based Comet markets.
- Relies on external swap/conversion modules and Comet's support for `withdrawFrom` and `supplyTo`._

### DeploymentParams

Struct for initializing deployment parameters of the Morpho adapter.

_This struct encapsulates all the necessary parameters required to deploy the `MorphoUsdsAdapter` contract.
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
  address morphoLendingPool;
  bool isFullMigration;
  bool useSwapRouter02;
}
```

### MorphoPosition

Struct representing a user's full position in the Morpho protocol.

_This struct encapsulates all the necessary information about a user's Morpho position,
     enabling seamless migration of both debt and collateral to Compound III (Comet)._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct MorphoPosition {
  struct MorphoUsdsAdapter.MorphoBorrow[] borrows;
  struct MorphoUsdsAdapter.MorphoCollateral[] collateral;
}
```

### MorphoBorrow

Struct representing a single borrow position on Morpho.

_This struct is used to define the details of a borrow position, including the market ID,
     the amount to repay, and optional swap parameters for acquiring the repayment token._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct MorphoBorrow {
  Id marketId;
  uint256 assetsAmount;
  struct SwapModule.SwapInputLimitParams swapParams;
}
```

### MorphoCollateral

Struct representing a single collateral position on Morpho.

_This struct is used to define the details of a collateral position, including the market ID,
     the amount to migrate, and optional swap parameters for converting the collateral into a token
     compatible with the target Compound III market._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct MorphoCollateral {
  Id marketId;
  uint256 assetsAmount;
  struct SwapModule.SwapOutputLimitParams swapParams;
}
```

### IS_FULL_MIGRATION

```solidity
bool IS_FULL_MIGRATION
```

Boolean indicating whether the migration is a full migration.

_This immutable variable determines if the migration process requires all debt positions
     to be fully cleared. If set to `true`, the contract ensures that all outstanding debt
     is repaid during the migration process. It is initialized during the deployment of the
     `MorphoUsdsAdapter` contract._

### LENDING_POOL

```solidity
contract IMorpho LENDING_POOL
```

Morpho Lending Pool contract address.

_This immutable variable holds the address of the Morpho Lending Pool, which is used to perform
     operations such as withdrawing collateral, repaying debt, and fetching user positions. It is
     initialized during the deployment of the `MorphoUsdsAdapter` contract._

### DebtNotCleared

```solidity
error DebtNotCleared(address spToken)
```

This error is triggered during a full migration when the user's debt for a specific asset
        in Morpho has not been fully repaid after the repayment process.

_Reverts if the debt for a specific token has not been successfully cleared._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| spToken | address | The address of the token associated with the uncleared debt. |

### constructor

```solidity
constructor(struct MorphoUsdsAdapter.DeploymentParams deploymentParams) public
```

Initializes the MorphoUsdsAdapter contract with deployment parameters.

_The constructor initializes the `SwapModule` and `ConvertModule` with the provided Uniswap router
     and stablecoin converter addresses. It also validates that the Morpho Lending Pool address is non-zero.
     All parameters are stored as immutable for gas efficiency and safety.

Requirements:
- `morphoLendingPool` must not be a zero address.

Warning:
- If `daiUsdsConverter`, `dai`, or `usds` are set to zero addresses, USDS-specific logic (e.g., DAI ⇄ USDS conversions)
  will not be supported. In this case, only standard token swaps will be available for migration.

Reverts:
- {InvalidZeroAddress} if `morphoLendingPool` is a zero address._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| deploymentParams | struct MorphoUsdsAdapter.DeploymentParams | Struct containing the following deployment parameters:        - `uniswapRouter`: Address of the Uniswap V3 SwapRouter contract.        - `daiUsdsConverter`: Address of the DAI ⇄ USDS converter contract (optional, can be zero address).        - `dai`: Address of the DAI token (optional, can be zero address).        - `usds`: Address of the USDS token (optional, can be zero address).        - `morphoLendingPool`: Address of the Morpho Lending Pool contract.        - `isFullMigration`: Boolean flag indicating whether the migration requires all debt to be cleared.        - `useSwapRouter02`: Boolean flag indicating whether to use Uniswap V3 SwapRouter02. |

### executeMigration

```solidity
function executeMigration(address user, address comet, bytes migrationData, bytes flashloanData, uint256 preBaseAssetBalance) external
```

Executes the migration of a user's full or partial position from Morpho to Compound III (Comet).

_This function performs the following steps:
 1. Decodes the encoded `migrationData` into a `MorphoPosition` struct containing the user's
    borrow and collateral positions across one or more Morpho markets.
 2. Iterates through all borrow positions and calls `_repayBorrow`, which handles repayment logic
    including optional swaps or stablecoin conversion.
 3. Iterates through all collateral positions and calls `_migrateCollateral`, which handles withdrawal
    from Morpho and supply to Comet. The migration may involve swaps via Uniswap V3 or DAI ⇄ USDS conversion.
 4. If flash loan data is provided, settles the flash loan using `_repayFlashloan`, covering
    repayment either from contract balance or the user’s Comet account._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose Morpho position is being migrated. |
| comet | address | The address of the target Compound III (Comet) contract that will receive the migrated assets. |
| migrationData | bytes | ABI-encoded `MorphoPosition` struct that contains:        - An array of `MorphoBorrow` entries representing debts to repay.        - An array of `MorphoCollateral` entries representing collaterals to migrate. |
| flashloanData | bytes | Optional ABI-encoded data used to repay a Uniswap V3 flash loan if used.        Should be empty if no flash loan was taken (e.g., in pure collateral migration scenarios). |
| preBaseAssetBalance | uint256 | The contract's base token balance before the migration process begins. Requirements: - The user must approve this contract to transfer their debt and collateral positions. - The `migrationData` must be correctly encoded and represent valid Morpho positions. - If a flash loan is used, the `flashloanData` must be valid and sufficient to cover the loan repayment. Effects: - Repays borrow positions in Morpho. - Migrates collateral positions from Morpho to Compound III. - Optionally repays flash loans if used during the migration process. Warning: - This contract does not support Fee-on-transfer tokens. Using such tokens may result in unexpected behavior or reverts. Reverts: - If any borrow repayment, collateral migration, or flash loan repayment fails. - If the migration process encounters invalid swap paths or insufficient allowances. |

### _repayFlashloan

```solidity
function _repayFlashloan(address user, address comet, bytes flashloanData, uint256 preBaseAssetBalance) internal
```

Repays a flash loan obtained from a Uniswap V3 liquidity pool during the migration process.

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
| preBaseAssetBalance | uint256 | The contract's base token balance before the flash loan was taken. Requirements: - The contract must ensure full repayment of `flashAmountWithFee` in `flashBaseToken`. - If the contract's balance is insufficient, it must withdraw the difference from the user's Comet account. - If the repayment token is DAI and the market uses USDS, conversion must occur prior to transfer. Effects: - May withdraw assets from the user’s Compound III account using `withdrawFrom()`. - May trigger `_convertUsdsToDai()` if conversion is necessary. - Completes repayment with `safeTransfer()` to the liquidity pool. |

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
function _repayBorrow(address user, struct MorphoUsdsAdapter.MorphoBorrow borrow) internal
```

Repays a borrow position for the user in the Morpho protocol.

_This function performs the following steps:
 1. Retrieves market parameters and accrues interest for the specified market.
 2. If `assetsAmount` is `type(uint256).max`, calculates the full debt in assets using the user's borrow shares.
 3. If a swap is required (as defined in `swapParams.path`), it either:
    - Converts USDS to DAI if needed, or
    - Executes a Uniswap V3 swap to acquire the borrow token.
 4. Increases allowance for the `loanToken` to the Morpho lending pool.
 5. Executes the repayment by calling `repay()` on the Morpho pool using the user's borrow shares.
 6. If `IS_FULL_MIGRATION` is enabled, verifies that the user has no remaining debt after repayment._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose borrow position is being repaid. |
| borrow | struct MorphoUsdsAdapter.MorphoBorrow | Struct containing:        - `marketId`: The ID of the Morpho market.        - `assetsAmount`: The amount of debt to repay (use `type(uint256).max` to repay all).        - `swapParams`: Parameters for acquiring the repayment token via Uniswap V3 or USDS conversion. Requirements: - User must have an active borrow position in the specified market. - If swapping is required, sufficient token balances must be available or convertible. - Repayment must fully clear the debt if `IS_FULL_MIGRATION` is enabled. Effects: - May trigger interest accrual. - May perform a Uniswap V3 swap or USDS → DAI conversion. - May revert with `DebtNotCleared` if full migration check fails. |

### _migrateCollateral

```solidity
function _migrateCollateral(address user, address comet, struct MorphoUsdsAdapter.MorphoCollateral collateral) internal
```

Migrates a user's collateral position from Morpho to Compound III (Comet).

_This function performs the following steps:
 1. Retrieves the user's position and market parameters from the Morpho protocol.
 2. Determines the amount of collateral to migrate. If `assetsAmount` is set to `type(uint256).max`,
    it migrates the entire collateral balance.
 3. Calls `withdrawCollateral` to transfer the specified amount from the user to this contract.
 4. If a swap is required:
    - Converts DAI → USDS if applicable using `_convertDaiToUsds()`.
    - Otherwise, performs a Uniswap V3 swap defined by `swapParams`.
    - If the Comet base token is USDS but the output token is DAI, converts DAI → USDS.
 5. Supplies the resulting token (USDS, DAI, or other) to the Compound III market via `supplyTo()`.
 6. If no swap is needed, supplies the collateral directly to the Comet market._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| user | address | The address of the user whose Morpho collateral is being migrated. |
| comet | address | The address of the target Compound III (Comet) contract to receive the supplied asset. |
| collateral | struct MorphoUsdsAdapter.MorphoCollateral | Struct containing:        - `marketId`: The ID of the Morpho market from which to withdraw collateral.        - `assetsAmount`: The amount to migrate (use `type(uint256).max` to migrate all).        - `swapParams`: Parameters for performing optional swaps or conversions. Requirements: - The user must have sufficient collateral in the specified Morpho market. - If a swap or conversion is required, enough token liquidity must be available. Effects: - May trigger withdrawals from Morpho. - May invoke Uniswap V3 swaps or DAI → USDS conversions. - Supplies the resulting token to the Compound III market. |

### _isDebtCleared

```solidity
function _isDebtCleared(Id id, address user) internal view returns (bool isCleared)
```

Checks whether the user's debt position in a specific Morpho market is fully repaid.

_Fetches the current `Position` data for the user in the given Morpho market ID.
     The function evaluates whether the user's `borrowShares` equals zero, indicating
     that the user has no remaining outstanding borrow debt in that market._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | Id | The market ID in Morpho for which the debt status is being checked. |
| user | address | The address of the user whose debt is being verified. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| isCleared | bool | Boolean flag indicating whether the debt has been fully cleared (`true`)         or if borrow shares are still present (`false`). |

