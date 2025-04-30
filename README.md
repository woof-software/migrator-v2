# MigratorV2

**MigratorV2** is a flexible contract for migrating user positions from various lending protocols (Aave, Spark, Morpho) to Compound III (Comet). The contract is built with a modular architecture, utilizing universal adapters for each protocol, and supports extension without the need for redeployment.

---

## **📄 Key Features**

-   **Migration from Aave, Spark, and Morpho to Compound III**

Users can transfer their collateral and debt positions from three major protocols (Aave V3, Spark Protocol, Morpho Blue) to Compound III (Comet). This avoids manual asset withdrawal and debt repayment, reduces gas costs, and minimizes risks of temporarily exiting positions.

-   **Universal Adapters**

Each supported lending protocol now uses a single universal adapter:

-   **AaveV3UsdsAdapter**
-   **SparkUsdsAdapter**
-   **MorphoUsdsAdapter**

These adapters are designed to handle all supported networks and USDS-specific behavior.

-   **Flexible Position Migration**

Users can choose which specific collaterals and debts to migrate. For example, out of four collateral assets, they can choose to migrate only two, provided the health factor is preserved in the source protocol. This flexibility enables users to adapt migration to their individual strategies.

-   **Debt-Free Migration**

If the user has no active debt but holds collateral in the protocol (e.g., only aTokens in Aave), they can migrate just the collateral. In this case, **no flash loan is needed**, making the transaction significantly cheaper. The contract simply withdraws the collateral and deposits it into Compound III on behalf of the user.

-   **Customizable Target Collateral Format in Compound III**

Before migration, users can choose the format for depositing into Compound III:

-   The base token of the market (e.g., USDC or USDS)
-   One of the supported collateral tokens

This allows them to preserve or simplify their portfolio structure.

-   **USDS Migration via DAI Proxy Mechanism**

If the Compound market uses USDS as the base token, the contract uses DAI as an intermediary token, provided that the swap configuration specifies a conversion path rather than a token swap path.

---

## 🪡 When is Proxy DAI Mode Used?

MigratorV2 supports using **DAI as a proxy token** for USDS markets when:

-   USDS liquidity is too low in Uniswap pools.
-   Flash loans in USDS are unavailable or inefficient.

In this mode:

-   Flash loan is taken in DAI.
-   DAI is used to repay debt or is converted to USDS before depositing.
-   During repayment, USDS is withdrawn from Comet and converted to DAI if needed.

> ⚠️ The contract automatically performs conversions via `ConvertModule`. Frontend must provide correct specifies a conversion path. Use helper methods to get the conversion path.

---

## **🚀 How Migration Works**

1. **Debt Repayment**:
    - The contract receives a flash loan in the base token of the Compound market (e.g., USDC or DAI for USDS markets).
    - The funds are used to repay the user’s debt in the source protocol (Aave, Spark, or Morpho).
2. **Collateral Migration**:
    - The contract withdraws the user’s collateral from the source protocol.
    - If needed, it performs a swap or conversion (e.g., DAI ⇄ USDS).
    - Users can choose which collaterals to migrate or migrate all — fully or partially.
3. **Deposit into Compound III**:
    - The collateral is deposited on behalf of the user into the selected Compound III market.
    - The user can choose:
        - **The market’s base token** — e.g., USDC or USDS
        - **Supported collateral tokens** — e.g., WBTC, WETH, etc.

---

## **💡 Flash Loan Repayment Logic**

-   If **all collaterals are migrated into the market as base tokens**, a portion of those funds will be **automatically used to repay the flash loan** plus the fee. After migration, the user’s balance will reflect the total collateral minus flash loan repayment costs.
-   If **collaterals are migrated as supported tokens (not base asset)**:
    -   The contract attempts to cover the flash loan by **withdrawing the required base token amount** from the user’s Compound III deposit.
    -   If only collateral tokens are deposited (no base asset), the contract **withdraws funds from the user’s Compound balance** (via `withdrawFrom`) to repay the flash loan.
-   In case of a **mixed migration** (some collaterals as base token, others as collateral tokens):
    -   If **the deposited base token is insufficient** to fully repay the flash loan, a **debt is created for the difference**, which is either deducted from the base token or withdrawn from the collateral in Compound.

---

## **🚧 Migration Prerequisites**

**Grant permissions to the migrator contract**:

-   **For Aave protocols:**

```
await aToken.approve(migrator.address, amount);
```

-   **For Spark protocol:**

```
await spToken.approve(migrator.address, amount);
```

-   **For Morpho protocol:**

```
await morphoPool.connect(user).setAuthorization(migrator.address, true);
```

-   **For Compound III (Comet):**

```
await comet.allow(migrator.address, true);
```

---

## **⚠️ Important Notes**

-   **Fee-on-transfer Tokens are not supported** for migration. Ensure that all tokens involved in the migration process do not have transfer fees.
-   The frontend must calculate the flash loan amount so that the user maintains a safe Health Factor in the new Compound market after migration. An incorrectly calculated flash loan could leave the user at risk of immediate liquidation after migration.
-   User must approve this contract to transfer relevant spTokens and debtTokens.
-   The user must grant permission to the Migrator contract to interact with their tokens in the target Compound III market:
    `IComet.allow(migratorV2.address, true)`.
-   Underlying assets must be supported by Uniswap or have valid conversion paths via `ConvertModule`.
-   Swap parameters must be accurate and safe (e.g., `amountInMaximum` and `amountOutMinimum`).

---

## **📖 Helper Methods**

### **getEncodedDaiToUsdsConversionPath()**

-   **Purpose**: Returns the encoded path for converting DAI to USDS.
-   **Use Case**: Used when the migration involves converting DAI to USDS in proxy mode.

### **getEncodedUsdsToDaiConversionPath()**

-   **Purpose**: Returns the encoded path for converting USDS to DAI.
-   **Use Case**: Used when the migration involves converting USDS to DAI in proxy mode.

---

## **📃 Administrative Functions (Owner Only)**

-   `setAdapter(address)` — Add a new adapter.
-   `removeAdapter(address)` — Remove an adapter.
-   `setFlashData(address comet, FlashData flashData)` — Set flash loan configuration.
-   `removeFlashData(address comet)` — Remove flash loan data for a market.
-   `pause()` — Pause the contract.
-   `unpause()` — Unpause the contract.

---

## **🛡️ Error Handling**

The following errors may occur during the migration process:

-   **InvalidZeroAddress**  
    Reverts if an address provided is zero.  
    _Example: When initializing the contract or setting an adapter with a zero address._

-   **InvalidAdapter**  
    Reverts if the specified adapter is not registered or allowed.  
    _Example: When attempting to use an unregistered protocol adapter for migration._

-   **CometIsNotSupported**  
    Reverts if the provided Compound III (Comet) contract is not supported.  
    _Example: When attempting to migrate to a Comet market that has no flash loan configuration._

-   **InvalidMigrationData**  
    Reverts if the migration data provided is empty or invalid.  
    _Example: When the `migrationData` parameter is improperly encoded or missing required fields._

-   **DelegatecallFailed**  
    Reverts if the delegatecall to the adapter fails.  
    _Example: When the adapter logic encounters an error during execution._

-   **BaseTokenMismatch**  
    Reverts if the base token in the flash loan configuration does not match the Comet base token.  
    _Example: When the flash loan token is incompatible with the target Comet market._

-   **InvalidCallbackHash**  
    Reverts if the callback data hash does not match the stored hash during a flash loan callback.  
    _Example: When the flash loan callback is tampered with or improperly executed._

-   **SenderNotUniswapPool**  
    Reverts if the caller of the flash loan callback is not the expected Uniswap V3 pool.  
    _Example: When the callback is invoked by an unauthorized address._

-   **MismatchedArrayLengths**  
    Reverts if the lengths of provided arrays (e.g., adapters and flash loan configurations) do not match.  
    _Example: When initializing the contract with inconsistent input arrays._

-   **AdapterAlreadyAllowed**  
    Reverts if the adapter is already registered.  
    _Example: When attempting to register an adapter that is already in the list of allowed adapters._

-   **CometAlreadyConfigured**  
    Reverts if the Comet contract is already configured with flash loan data.  
    _Example: When attempting to set flash loan data for a Comet market that is already configured._

-   **DebtNotCleared**  
    Reverts if the user's debt for a specific asset is not fully repaid during a full migration.  
    _Example: When attempting a full migration but residual debt remains in the source protocol._

-   **ConversionFailed**  
    Reverts if the amount of tokens received from a DAI ⇄ USDS conversion does not match the expected amount.  
    _Example: When the stablecoin conversion process fails or produces an incorrect output amount._

-   **EmptySwapPath**  
    Reverts if a swap operation is attempted without specifying a valid token swap path.  
    _Example: When the `path` parameter for a Uniswap V3 swap is empty or improperly encoded._

-   **ZeroAmountIn**  
    Reverts if a swap operation is attempted with an input amount of zero.  
    _Example: When the input token amount for a swap is zero, resulting in no tokens being swapped._

-   **ZeroAmountOut**  
    Reverts if a swap operation is attempted but the resulting output token amount is zero.  
    _Example: When the swap produces no output tokens due to insufficient liquidity or invalid parameters._

-   **ZeroAmountInMaximum**  
    Reverts if a swap operation is attempted with a maximum input amount of zero.  
    _Example: When the `amountInMaximum` parameter for a swap is zero, preventing the swap from executing._

-   **ZeroAmountOutMinimum**  
    Reverts if a swap operation is attempted with a minimum output amount of zero.  
    _Example: When the `amountOutMinimum` parameter for a swap is zero, allowing the swap to produce no output tokens._

-   **InvalidSwapDeadline**  
    Reverts if a swap operation is attempted with a deadline that is zero or has already passed.  
    _Example: When the `deadline` parameter for a swap is invalid or expired._

> ℹ️ These errors are designed to ensure the integrity and security of the migration process. Proper input validation and adherence to the contract's requirements can help avoid these errors.

---

### **🔁 Example 1: Migrating Debt and Collateral with Swaps**

```typescript
const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

const position = {
    borrows: [
        {
            debtToken: aaveContractAddresses.variableDebtToken.USDC,
            amount: MaxUint256,
            swapParams: {
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20),
                    FEE_3000,
                    ethers.utils.hexZeroPad(tokenAddresses.DAI, 20)
                ]),
                deadline,
                amountInMaximum: parseUnits("100", 6)
            }
        }
    ],
    collaterals: [
        {
            aToken: aaveContractAddresses.aToken.WBTC,
            amount: MaxUint256,
            swapParams: {
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                    FEE_3000,
                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                ]),
                deadline,
                amountOutMinimum: parseUnits("50", 6)
            }
        }
    ]
};

const abi = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const migrationData = ethers.utils.defaultAbiCoder.encode(
    ["tuple(" + abi.join(",") + ")"],
    [[position.borrows, position.collaterals]]
);

await migratorV2.migrate(
    aaveV3Adapter.address,
    compoundContractAddresses.markets.cUSDCv3,
    migrationData,
    parseUnits("1000", 6) // Flash loan amount
);
```

---

### **🔁 Example 2: Migrating Only Collateral (No Debt)**

```typescript
const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

const position = {
    borrows: [],
    collaterals: [
        {
            aToken: aaveContractAddresses.aToken.WBTC,
            amount: MaxUint256,
            swapParams: {
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                    FEE_3000,
                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                ]),
                deadline,
                amountOutMinimum: parseUnits("50", 6)
            }
        }
    ]
};

const abi = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const migrationData = ethers.utils.defaultAbiCoder.encode(
    ["tuple(" + abi.join(",") + ")"],
    [[position.borrows, position.collaterals]]
);

await migratorV2.migrate(
    aaveV3Adapter.address,
    compoundContractAddresses.markets.cUSDCv3,
    migrationData,
    0 // No flash loan
);
```

---

### **🔄 Example 3: DAI ⇄ USDS Conversion Path**

```typescript
const daiToUsdsPath = await migratorV2.getEncodedDaiToUsdsConversionPath();
console.log("DAI to USDS Path:", daiToUsdsPath);

const usdsToDaiPath = await migratorV2.getEncodedUsdsToDaiConversionPath();
console.log("USDS to DAI Path:", usdsToDaiPath);
```

---

## 🌐 Deployed Contracts

> ℹ️ Contractual addresses are placeholders. Contracts will be deployed and addresses updated after the audit is completed.

### Arbitrum

-   `MigratorV2`: [`0x0000000000000000000000000000000000000000`](https://arbiscan.io/address/0x0000000000000000000000000000000000000000#code)
-   `AaveV3UsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://arbiscan.io/address/0x0000000000000000000000000000000000000000#code)

---

### Base

-   `MigratorV2`: [`0x0000000000000000000000000000000000000000`](https://basescan.org/address/0x0000000000000000000000000000000000000000#code)
-   `AaveV3UsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://basescan.org/address/0x0000000000000000000000000000000000000000#code)
-   `MorphoUsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://basescan.org/address/0x0000000000000000000000000000000000000000#code)

---

### Ethereum

-   `MigratorV2`: [`0x0000000000000000000000000000000000000000`](https://etherscan.io/address/0x0000000000000000000000000000000000000000#code)
-   `AaveV3UsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://etherscan.io/address/0x0000000000000000000000000000000000000000#code)
-   `SparkUsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://etherscan.io/address/0x0000000000000000000000000000000000000000#code)
-   `MorphoUsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://etherscan.io/address/0x0000000000000000000000000000000000000000#code)

---

### Polygon

-   `MigratorV2`: [`0x0000000000000000000000000000000000000000`](https://polygonscan.com/address/0x0000000000000000000000000000000000000000#code)
-   `AaveV3UsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://polygonscan.com/address/0x0000000000000000000000000000000000000000#code)

---

### Optimism

-   `MigratorV2`: [`0x0000000000000000000000000000000000000000`](https://optimistic.etherscan.io/address/0x0000000000000000000000000000000000000000#code)
-   `AaveV3UsdsAdapter`: [`0x0000000000000000000000000000000000000000`](https://optimistic.etherscan.io/address/0x0000000000000000000000000000000000000000#code)

---

## **🔖 License**

The project is licensed under **BUSL-1.1 License**.
