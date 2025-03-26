# MigratorV2

**MigratorV2** is a flexible contract for migrating user positions from various lending protocols (Aave, Spark, Morpho) to Compound III (Comet), using Uniswap V3 flash loans. The contract is built with a modular architecture, utilizing adapters for each protocol, and supports extension without the need for redeployment.

---

## **📄 Key Features**

-   **Migration from Aave, Spark, and Morpho to Compound III**

Users can transfer their collateral and debt positions from three major protocols (Aave V3, Spark Protocol, Morpho Blue) to Compound III (Comet). This avoids manual asset withdrawal and debt repayment, reduces gas costs, and minimizes risks of temporarily exiting positions.

-   **6 Adapters: 2 per Protocol**

Each supported lending protocol has two types of adapters:

-   A base adapter — supports all networks where the protocol is available.
-   A USDS-supporting adapter — designed for Ethereum, handling USDS-specific behavior.
-   **Flexible Position Migration**

Users can choose which specific collaterals and debts to migrate. For example, out of four collateral assets, they can choose to migrate only two, provided the health factor is preserved in the source protocol. This flexibility enables users to adapt migration to their individual strategies.

-   **Debt-Free Migration**

If the user has no active debt but holds collateral in the protocol (e.g., only aTokens in Aave), they can migrate just the collateral. In this case, **no flash loan is needed**, making the transaction significantly cheaper. The contract simply withdraws the collateral and deposits it into Compound III on behalf of the user.

-   **Full Position Migration Support**

Currently, only full migration of each selected position is supported — if a user selects a specific debt or collateral, the entire amount is migrated. Partial migration (e.g., 50% of a debt) will be added in future updates.

-   **Customizable Target Collateral Format in Compound III**

After migration, users can choose the format for depositing into Compound III:

-   The base token of the market (e.g., USDC or USDS)
-   One of the supported collateral tokens

This allows them to preserve or simplify their portfolio structure.

-   **USDS Migration via DAI Proxy Mechanism**

If a user interacts with Compound markets that use USDS as the base token, but USDS liquidity is low, the contract uses DAI as an intermediary token:

-   Flash loans, swaps, and deposits are executed in DAI.
-   The contract automatically converts DAI ⇄ USDS when needed.
-   Switching to direct USDS usage is possible in the future without redeployment.

---

## **🚀 How Migration Works**

1. **Debt Repayment**:
    - The contract receives a flash loan from Uniswap V3 (in the base token of the Compound market, or in DAI if the market uses USDS, based on migrator contract configuration).
    - The funds are used to repay the user’s debt in the source protocol (Aave, Spark, or Morpho).
2. **Collateral Migration**:
    - The contract withdraws the user’s collateral from the source protocol.
    - If needed, it performs a swap via Uniswap V3 or a conversion (e.g., DAI ⇄ USDS).
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
-   If only collateral tokens are deposited (no base asset), the contract **withdraws funds from the user’s Compound balance** (via withdrawFrom) to repay the flash loan.
-   In case of a **mixed migration** (some collaterals as base token, others as collateral tokens):
-   If **the deposited base token is insufficient** to fully repay the flash loan, a **debt is created for the difference**, which is either deducted from the base token or withdrawn from the collateral in Compound.

> ⚠️ Important: The frontend must calculate the flash loan amount so that the user maintains a safe Health Factor in the new Compound market after migration. It must account for all variables: remaining base token balance, deposited collaterals, and potential flash loan repayment costs. An incorrectly calculated flash loan could leave the user at risk of immediate liquidation after migration.

-   The collateral is deposited into the selected Compound III market.
-   If the target market uses USDS as the base token, the DAI proxy mechanism is used.

---

## **📖 Building Transactions for migrate()**

### **🔁 Example 1: Swapping debt and collateral via Uniswap V3**

```
const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0x0BB8

const position = {
  borrows: [
    {
      debtToken: varDebtDaiTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: ethers.utils.concat([
          ethers.utils.hexZeroPad(daiTokenAddress, 20),
          fee3000,
          ethers.utils.hexZeroPad(usdcTokenAddress, 20)
        ]),
        amountInMaximum: parseUnits("80", 6)
      }
    }
  ],
  collaterals: [
    {
      aToken: aWbtcTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: ethers.utils.concat([
          ethers.utils.hexZeroPad(wbtcTokenAddress, 20),
          fee3000,
          ethers.utils.hexZeroPad(usdcTokenAddress, 20)
        ]),
        amountOutMinimum: parseUnits("100", 6)
      }
    }
  ]
};

const abi = [
  "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
  "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

const migrationData = ethers.utils.defaultAbiCoder.encode([
  "tuple(" + abi.join(",") + ")"
], [[position.borrows, position.collaterals]]);
```

### **🔁 Example 2: Migrating only collateral (no debt)**

```
const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3);

const position = {
  borrows: [],
  collaterals: [
    {
      aToken: aWbtcTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: ethers.utils.concat([
          ethers.utils.hexZeroPad(wbtcTokenAddress, 20),
          fee3000,
          ethers.utils.hexZeroPad(usdcTokenAddress, 20)
        ]),
        amountOutMinimum: parseUnits("100", 6)
      }
    }
  ]
};

const abi = [...]; // same as above
const migrationData = ethers.utils.defaultAbiCoder.encode([
  "tuple(" + abi.join(",") + ")"
], [[position.borrows, position.collaterals]]);
```

### **⚡ Example 3: No swaps (direct transfer)**

```
const position = {
  borrows: [
    {
      debtToken: varDebtDaiTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: "0x",
        amountInMaximum: 0
      }
    }
  ],
  collaterals: [
    {
      aToken: aWbtcTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: "0x",
        amountOutMinimum: 0
      }
    }
  ]
};
```

### **🔄 Example 4: DAI <-> USDS Conversion**

```
const position = {
  borrows: [
    {
      debtToken: varDebtDaiTokenAddress,
      amount: MaxUint256,
      swapParams: {
        path: ethers.utils.concat([
          ethers.utils.hexZeroPad(usdsTokenAddress, 20),
          ethers.utils.hexZeroPad(daiTokenAddress, 20)
        ]),
        amountOutMinimum: parseUnits("120", 18)
      }
    }
  ],
  collaterals: [...]
};
```

---

## **🚧 Migration Prerequisites**

1. **Grant permissions to the migrator contract**:

-   **For Aave and Spark protocols:**

```
await aToken.approve(migrator.address, ethers.utils.parseUnits("0.1", 8));
await comet.allow(migrator.address, true);
```

-   **For Morpho protocol:**

```
await morphoPool.connect(user).setAuthorization(migrator.address, true);
```

1. **Frontend Responsibilities**:

-   Provide accurate swap routes and all migrationData parameters.
-   Ensure approval of all involved tokens (debts and collaterals).
-   Account for the DAI ⇄ USDS proxy conversion logic.

---

## **🧭 Optimal Swap Routing — UniswapV3PathFinder**

The UniswapV3PathFinder contract assists the frontend in building the most efficient swap paths through Uniswap V3. It selects the best route for both single-hop and multi-hop swaps, optimizing either the received token amount or minimizing input costs for a given amountOut.

## **🔍 Key Features**

-   Supports both exactInput and exactOutput modes.
-   Automatically finds the best pool (from fee tiers: 0.01%, 0.05%, 0.3%, 1%).
-   Supports excluding specific pools (excludedPool) — to avoid pool reuse within the same transaction.
-   Special handling for DAI ⇄ USDS — returns direct path without querying.
-   maxGasEstimate parameter allows setting a gas limit during QuoterV2 queries.

---

## **✳️ Use Cases**

1.  **🔁 Single-Hop Swap — getBestSingleSwapPath**

```
function getBestSingleSwapPath(SingleSwapParams memory params)
    external
    returns (bytes memory path, uint256 estimatedAmount, uint256 gasEstimate);
```

**Input Parameters:**

-   tokenIn, tokenOut — token addresses
-   amountIn or amountOut — only one must be provided
-   excludedPool — optional pool to exclude
-   maxGasEstimate — required

---

1.  **🔀 Multi-Hop Swap — getBestMultiSwapPath**

```
function getBestMultiSwapPath(MultiSwapParams memory params)
    external
    returns (bytes memory path, uint256 estimatedAmount, uint256 gasEstimate);
```

**Input Parameters:**

-   tokenIn, tokenOut — token addresses
-   connectors — required list of possible intermediate tokens
-   amountIn or amountOut — only one must be set
-   excludedPool, maxGasEstimate

> 📌 Error if both amountIn and amountOut are set or both are zero.

---

## **⚙️ Frontend Example**

```
const params = {
  tokenIn: DAI,
  tokenOut: USDC,
  amountIn: parseUnits("100", 18),
  amountOut: 0,
  excludedPool: ZERO_ADDRESS,
  maxGasEstimate: 1_000_000
};

const { path, estimatedAmount, gasEstimate } = await pathFinder.getBestSingleSwapPath(params);
```

---

## **📎 Built-in USDS ⇄ DAI Support**

When tokenIn and tokenOut are DAI and USDS (or vice versa), the route is returned directly via abi.encodePacked(DAI, USDS) without querying the Quoter.

---

## **🛡️ Error Handling**

Returns errors for:

-   InvalidZeroAddress
-   OnlyOneAmountMustBeSet
-   MustBeSetAmountInOrAmountOut
-   MustBeSetMaxGasEstimate
-   SwapPoolsNotFound
-   MustBeAtLeastOneConnector (for multi-hop only)

> 🔧 **The contract is used only for off-chain swap path computation**

---

## **📃 Administrative Functions (Owner Only)**

-   setAdapter(address) — add a new adapter
-   removeAdapter(address) — remove an adapter
-   setFlashData(address comet, FlashData flashData) — set flash loan configuration
-   removeFlashData(address comet) — remove flash loan data for a market

---

## **🚀 Future Plans**

-   Enable partial position migration (by amount).
-   Transition from DAI proxy to direct USDS use (as liquidity allows).

---

## 🌐 Deployed Contracts

### Arbitrum

- `TestMigratorV2`: [`0x602198BDf1547086dC89d7b426822d95519D7844`](https://arbiscan.io/address/0x602198BDf1547086dC89d7b426822d95519D7844#code)  
- `TestAaveV3Adapter`: [`0xf0E4D3A96ebe87aE39560d2B19e53dCC00aB5d28`](https://arbiscan.io/address/0xf0E4D3A96ebe87aE39560d2B19e53dCC00aB5d28#code)  
- `TestUniswapV3PathFinder`: [`0xbe7873DF7407b570bDe3406e50f76AB1A63b748b`](https://arbiscan.io/address/0xbe7873DF7407b570bDe3406e50f76AB1A63b748b#code)  

---

### Base

- `TestMigratorV2`: [`0xd5D3C5492802D40E086B8cF12eB31D6BcC59ddA4`](https://basescan.org/address/0xd5D3C5492802D40E086B8cF12eB31D6BcC59ddA4#code)  
- `TestAaveV3Adapter`: [`0xD655Fb965aC05552e83A4c73A1F832024DC5F515`](https://basescan.org/address/0xD655Fb965aC05552e83A4c73A1F832024DC5F515#code)  
- `TestMorphoAdapter`: [`0x037642eA98cCaed61Ba2eEC17cc799FE6691d39E`](https://basescan.org/address/0x037642eA98cCaed61Ba2eEC17cc799FE6691d39E#code)  
- `TestUniswapV3PathFinder`: [`0x6e30F794aD268Cf92131303a4557B097CF93c621`](https://basescan.org/address/0x6e30F794aD268Cf92131303a4557B097CF93c621#code)  

---

### Ethereum

- `TestMigratorV2`: [`0x0ef2c369A5c5EbFe06C6a54276206b076319c99f`](https://etherscan.io/address/0x0ef2c369A5c5EbFe06C6a54276206b076319c99f#code)  
- `TestAaveV3UsdsAdapter`: [`0x147505db1811F3eE7aB5bb5d9Fed79f257F018E7`](https://etherscan.io/address/0x147505db1811F3eE7aB5bb5d9Fed79f257F018E7#code)  
- `TestSparkUsdsAdapter`: [`0x8c16F393923E586447f5D583396cc7aC3E8d4AB9`](https://etherscan.io/address/0x8c16F393923E586447f5D583396cc7aC3E8d4AB9#code)  
- `TestMorphoUsdsAdapter`: [`0x1EFe17A612D9D64075bC77A403D246b858b800ab`](https://etherscan.io/address/0x1EFe17A612D9D64075bC77A403D246b858b800ab#code)  
- `TestUniswapV3PathFinder`: [`0x876dD243c5ad4d9D9FAb98CAF71E16CB1833c9Ae`](https://etherscan.io/address/0x876dD243c5ad4d9D9FAb98CAF71E16CB1833c9Ae#code)  

---

### Polygon

- `TestMigratorV2`: [`0x70395912F72861FD42cA33Ce671bC936E5f29dCF`](https://polygonscan.com/address/0x70395912F72861FD42cA33Ce671bC936E5f29dCF#code)  
- `TestAaveV3Adapter`: [`0x0F4ee1b1B6451b7cE2b49378094695d3d6dE2e1d`](https://polygonscan.com/address/0x0F4ee1b1B6451b7cE2b49378094695d3d6dE2e1d#code)  
- `TestUniswapV3PathFinder`: [`0xdb83bc921d49Bf73326D7BBA36a8CF8211d62534`](https://polygonscan.com/address/0xdb83bc921d49Bf73326D7BBA36a8CF8211d62534#code)  

---

### Optimism

- `TestMigratorV2`: [`0x96d5e6C5821a384237673A4444ACf6721E4d9E1d`](https://optimistic.etherscan.io/address/0x96d5e6C5821a384237673A4444ACf6721E4d9E1d#code)  
- `TestAaveV3Adapter`: [`0x74c15Aa6f11029e900493e53898dD558aF4B842f`](https://optimistic.etherscan.io/address/0x74c15Aa6f11029e900493e53898dD558aF4B842f#code)  
- `TestUniswapV3PathFinder`: [`0xf145bc354aeca1E5EafB7f7F7d431cC7A308A990`](https://optimistic.etherscan.io/address/0xf145bc354aeca1E5EafB7f7F7d431cC7A308A990#code)  

---

## **🔖 License**

The project is licensed under **BUSL-1.1 License**.
