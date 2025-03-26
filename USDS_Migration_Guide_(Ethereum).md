# 🛠️ USDS Migration Guide

## ✨ Overview

Migrating positions to **Compound III** markets that use **USDS** as the base token introduces special logic due to USDS's limited liquidity in decentralized exchanges. The system provides **two modes** of migration:

1. **Direct USDS migration**: Flash loan and all operations are executed in USDS.
2. **Proxy DAI migration**: Flash loan and operations are executed in DAI, which is converted to/from USDS within the adapter.

The active mode depends on the **MigratorV2 contract configuration** for the target Comet market (defined in `FlashData`). Frontend **must know which base token** (USDS or DAI) is used when forming paths and calculating quotes.

---

## 🪡 When is Proxy DAI Mode Used?

MigratorV2 supports using **DAI as a proxy token** for USDS markets when:
- USDS liquidity is too low in Uniswap pools.
- Flash loans in USDS are unavailable or inefficient.

In this mode:
- Flash loan is taken in DAI.
- DAI is used to repay debt or is converted to USDS before depositing.
- During repayment, USDS is withdrawn from Comet and converted to DAI if needed.

> ⚠️ The contract automatically performs conversions via `ConvertModule`. Frontend must provide correct input/output tokens for swap routes.

---

## 🚀 Migration Example: Direct USDS

### ✅ Configuration
- Flash loan is configured with `baseToken = USDS`
- User wants to migrate from Aave to Compound III (USDS market)
- User debt: DAI
- User collateral: WETH
- Target: deposit collateral into USDS market as base token

### 🤹 Swap Paths
- **Debt swap path**: `USDS -> DAI` (direct conversion)
- **Collateral swap path**: `WETH -> USDS` (standard Uniswap path with fee)

### ⚖️ Migration Flow
1. Flash loan in USDS.
2. Convert USDS → DAI to repay Aave debt.
3. Withdraw WETH from Aave.
4. Swap WETH → USDS.
5. Supply USDS to Compound III.
6. Repay flash loan in USDS.

> 🔄 Use 2-token path for direct conversion:
> `path = abi.encodePacked(USDS, DAI)`

---

## 🚀 Migration Example: Proxy DAI

### ✅ Configuration
- Flash loan is configured with `baseToken = DAI` (proxy mode)
- Market base token is still USDS

### 🤹 Swap Paths
- **Debt swap path**: `DAI -> debt token` (Uniswap path)
- **Collateral swap path**: `WETH -> DAI` (Uniswap path)

### ⚖️ Migration Flow
1. Flash loan in DAI.
2. Use DAI directly or convert to repay debt.
3. Withdraw WETH from Aave.
4. Swap WETH → DAI.
5. Convert DAI → USDS inside contract.
6. Supply USDS to Compound III.
7. Repay flash loan in DAI.

> 🚀 Internal calls like `_convertDaiToUsds()` and `_convertUsdsToDai()` are triggered automatically based on token path.

---

## 🔮 Swap Path Construction

### ✅ Conversion (2-token path)
- Used when converting between USDS ⇄ DAI
```ts
// For direct conversion
path = abi.encodePacked(USDS, DAI); // or DAI, USDS
```

### ⚖️ Swap (Uniswap)
- Used for actual token swaps (includes fee)
```ts
// For standard Uniswap swap
path = abi.encodePacked(WETH, fee3000, DAI);
```

### 📂 Recommendation
Use `UniswapV3PathFinder`:
- It detects when to build direct path vs swap
- Automatically excludes paths with low liquidity

---

## ❌ Common Mistakes

| Mistake | Description |
|--------|-------------|
| ❌ Wrong base token in flash loan | Check MigratorV2 FlashData to know if it's DAI or USDS |
| ❌ Using swap path instead of conversion path | Swap path must contain fee; conversion path = 2 tokens only |
| ❌ Supplying wrong token to Compound | Contract handles this, but path must result in correct asset |

---

## ⚡ Developer Notes
- Always query `MigratorV2.getFlashData(comet)` before forming swap paths.
- Respect adapter logic: all conversions are conditional on input/output tokens.
- `DAI` proxy logic is hardcoded for `comet.baseToken == USDS && flashBaseToken == DAI`

---

## 🚤 Summary

| Mode | Flash Loan Token | Debt Repay | Collateral Supply |
|------|------------------|------------|-------------------|
| Direct USDS | USDS | USDS → DAI | WETH → USDS |
| Proxy DAI | DAI | DAI | WETH → DAI → USDS |

Both modes are supported transparently in `AaveV3UsdsAdapter`.
Correct behavior depends on correct swap paths and contract configuration.

> ⚠️ Frontend must adapt behavior based on active flash loan token.

**arbitrum**:

`TestMigratorV2`: — `0x602198BDf1547086dC89d7b426822d95519D7844`

https://arbiscan.io/address/0x602198BDf1547086dC89d7b426822d95519D7844#code

`TestAaveV3Adapter`: — `0xf0E4D3A96ebe87aE39560d2B19e53dCC00aB5d28`

https://arbiscan.io/address/0xf0E4D3A96ebe87aE39560d2B19e53dCC00aB5d28#code

`TestUniswapV3PathFinder`: — `0xbe7873DF7407b570bDe3406e50f76AB1A63b748b`

https://arbiscan.io/address/0xbe7873DF7407b570bDe3406e50f76AB1A63b748b#code

**base**:

`TestMigratorV2`: — `0xd5D3C5492802D40E086B8cF12eB31D6BcC59ddA4`

https://basescan.org/address/0xd5D3C5492802D40E086B8cF12eB31D6BcC59ddA4#code

`TestAaveV3Adapter`: — `0xD655Fb965aC05552e83A4c73A1F832024DC5F515`

https://basescan.org/address/0xD655Fb965aC05552e83A4c73A1F832024DC5F515#code

`TestMorphoAdapter`: — `0x037642eA98cCaed61Ba2eEC17cc799FE6691d39E`

https://basescan.org/address/0x037642eA98cCaed61Ba2eEC17cc799FE6691d39E#code

`TestUniswapV3PathFinder`: — `0x6e30F794aD268Cf92131303a4557B097CF93c621`

https://basescan.org/address/0x6e30F794aD268Cf92131303a4557B097CF93c621#code

**ethereum**:

`TestMigratorV2`: — `0x0ef2c369A5c5EbFe06C6a54276206b076319c99f`

https://etherscan.io/address/0x0ef2c369A5c5EbFe06C6a54276206b076319c99f#code

`TestAaveV3UsdsAdapter`: — `0x147505db1811F3eE7aB5bb5d9Fed79f257F018E7`

https://etherscan.io/address/0x147505db1811F3eE7aB5bb5d9Fed79f257F018E7#code

`TestSparkUsdsAdapter`: — `0x8c16F393923E586447f5D583396cc7aC3E8d4AB9`

https://etherscan.io/address/0x8c16F393923E586447f5D583396cc7aC3E8d4AB9#code

`TestMorphoUsdsAdapter`: — `0x1EFe17A612D9D64075bC77A403D246b858b800ab`

https://etherscan.io/address/0x1EFe17A612D9D64075bC77A403D246b858b800ab#code

`TestUniswapV3PathFinder`: — `0x876dD243c5ad4d9D9FAb98CAF71E16CB1833c9Ae`

https://etherscan.io/address/0x876dD243c5ad4d9D9FAb98CAF71E16CB1833c9Ae#code

**polygon**:

`TestMigratorV2`: — `0x70395912F72861FD42cA33Ce671bC936E5f29dCF`

https://polygonscan.com/address/0x70395912F72861FD42cA33Ce671bC936E5f29dCF#code

`TestAaveV3Adapter`: — `0x0F4ee1b1B6451b7cE2b49378094695d3d6dE2e1d`

https://polygonscan.com/address/0x0F4ee1b1B6451b7cE2b49378094695d3d6dE2e1d#code

`TestUniswapV3PathFinder`: — `0xdb83bc921d49Bf73326D7BBA36a8CF8211d62534`

https://polygonscan.com/address/0xdb83bc921d49Bf73326D7BBA36a8CF8211d62534#code

**optimism**:

`TestMigratorV2`:  — `0x96d5e6C5821a384237673A4444ACf6721E4d9E1d`

https://optimistic.etherscan.io/address/0x96d5e6C5821a384237673A4444ACf6721E4d9E1d#code

`TestAaveV3Adapter`: — `0x74c15Aa6f11029e900493e53898dD558aF4B842f` 

https://optimistic.etherscan.io/address/0x74c15Aa6f11029e900493e53898dD558aF4B842f#code

`TestUniswapV3PathFinder`: — `0xf145bc354aeca1E5EafB7f7F7d431cC7A308A990`

https://optimistic.etherscan.io/address/0xf145bc354aeca1E5EafB7f7F7d431cC7A308A990#code