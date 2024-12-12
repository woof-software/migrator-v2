
# MigratorV2

MigratorV2 is a flexible migration contract that enables the migration of user positions from various lending protocols (like Aave V3) to Compound III (Comet) using Uniswap V3 Flash Loans. The contract supports adding new protocols for migration, making it adaptable and future-proof.

The migration process involves repaying user debts, migrating collaterals, and re-supplying them to the Compound III (Comet) protocol. The contract interacts with a set of protocol-specific adapters to achieve flexible migration logic.

## 📋 Key Features
- **Protocol Flexibility**: Supports migration from multiple lending protocols to Compound III (Comet). New protocols can be easily added by registering a protocol adapter.
- **Flash Loan Support**: Uses Uniswap V3 flash loans to facilitate efficient debt repayments.
- **Cross-Protocol Position Transfer**: Manages the full migration of user collateral and debt positions.
- **Collateral Management**: Handles multiple types of collaterals, including options to drop unsupported collateral.
- **Token Wrapping/Unwrapping**: Supports wrapping/unwrapping of native tokens (like ETH <-> WETH) as needed for seamless collateral migration.
- **Swap Functionality**: Uses Uniswap V3 swaps for liquidity and token exchanges where required.
- **Slippage Management**: Slippage protection for all token swaps.
- **Frontend Integration**: The user must provide all required amounts, routes, and addresses from the frontend.

---

## 🛠️ Project Setup

This project uses **Hardhat** as the development environment and **npm** as the package manager. To initialize the project, follow these steps:

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/your-username/migrator-v2.git
cd migrator-v2
```

### 2️⃣ Install Dependencies
```bash
npm install
```

### 3️⃣ Compile the Contracts
```bash
npx hardhat compile
```

### 4️⃣ Run Tests
```bash
npx hardhat test
```

### 5️⃣ Deploy the Contracts
```bash
npx hardhat run scripts/deploy.js --network your-network-name
```

---

## 📚 Key Contracts
- **MigratorV2.sol**: The main migrator contract that facilitates the migration process.
- **BaseAdapter.sol**: An abstract contract that serves as a base for protocol-specific adapters.
- **AaveV3Adapter.sol**: A protocol adapter for migrating user positions from Aave V3 to Compound III.
- **SwapModule.sol**: A utility module for Uniswap V3 swaps to support collateral migration and token exchanges.

---

## 📝 Contract Overview

### 1️⃣ **MigratorV2**
The `MigratorV2` contract serves as the main entry point for users to initiate a position migration. It uses **Uniswap V3 flash loans** to acquire liquidity for repaying user debts on the source protocol. After the debt is repaid, the user’s collateral is withdrawn and migrated to Compound III. New protocols can be added by registering new protocol adapters.

### 2️⃣ **BaseAdapter**
The `BaseAdapter` contract contains shared logic for protocol-specific adapters. It includes methods for **DAI <-> USDS conversions**, **token wrapping/unwrapping** (like ETH <-> WETH), and shared helper functions used by protocol adapters.

### 3️⃣ **AaveV3Adapter**
The `AaveV3Adapter` inherits from `BaseAdapter` and provides specific logic for migrating user positions from **Aave V3** to **Compound III**. It implements all the necessary logic to **repay Aave V3 debts**, **withdraw user collateral**, and **resupply it to Compound III**.

---

## 🔄 How Migration Works

1. **Debt Repayment**:
   - The contract takes a **flash loan** from Uniswap V3.
   - The borrowed tokens are used to repay the user’s debts on the source protocol (e.g., Aave V3).

2. **Collateral Migration**:
   - After repaying the debt, the **collateral is withdrawn** from the source protocol.
   - If the new protocol does not support a specific type of collateral, it can be **dropped or exchanged** via Uniswap V3.
   - The wrapped native tokens (like WETH) can be **unwrapped** if the new protocol requires it.

3. **Collateral Supply**:
   - The collateral is **supplied to the target protocol** (like Compound III) on behalf of the user.
   - Optionally, if the user prefers to supply the network’s **native token** instead of an ERC20 version (like ETH instead of WETH), the collateral will be **unwrapped**.

---

## 🔧 How to Initialize MigratorV2

When deploying `MigratorV2`, you can optionally register initial protocol adapters, Comet contracts, and flash loan configurations. However, these values can also be set later.

### Deployment Parameters

| **Parameter**  | **Type**    | **Description** |
|-----------------|------------|-----------------|
| `multisig`      | `address`   | The address of the owner (typically a multisig) |
| `adapters`      | `address[]` | (Optional) List of protocol adapters to register |
| `comets`        | `address[]` | (Optional) List of Comet contracts to support |
| `flashData`     | `FlashData[]` | (Optional) Flash loan configuration data |

> **Note**: These parameters are optional. If not provided during deployment, the adapters, comets, and flash loan data can be set later using the owner functions.

---

## 🔍 migrate() Method

The `migrate()` method is the main function that users will call to start a migration.

### **Arguments**

| **Argument**    | **Type**    | **Description** |
|-----------------|------------|-----------------|
| `adapter`       | `address`   | Address of the protocol adapter to use for migration |
| `comet`         | `address`   | Address of the Comet contract to migrate to |
| `migrationData` | `bytes`     | Encoded data that describes the user’s position |
| `flashAmount`   | `uint256`   | Amount of the flash loan required for the migration |

---

## 💻 Usage Example

```javascript
// Required imports
const { ethers } = require("hardhat");

// Assuming we have an instance of the MigratorV2 contract
const migrator = await ethers.getContractAt("MigratorV2", "0x123...456");

// Prepare migration data
const migrationData = ethers.utils.defaultAbiCoder.encode(
  ["address", "uint256"],
  ["0xAaveV3DebtTokenAddress", "1000000000000000000"] // Borrow position (token address and amount)
);

// Call the migrate function
await migrator.migrate(
  "0xProtocolAdapterAddress",  // Address of the protocol adapter
  "0xCompoundCometAddress",    // Address of the Comet contract
  migrationData,               // Encoded migration data
  ethers.utils.parseEther("10") // Flash loan amount
);
```

---

## 📚 Available Functions

### **Owner-Only Functions**
- `setAdapter(address adapter)`: Adds a new protocol adapter.
- `removeAdapter(address adapter)`: Removes a protocol adapter.
- `setFlashData(address comet, FlashData memory flashData)`: Sets the flash loan configuration for a Comet contract.
- `removeFlashData(address comet)`: Removes flash loan configuration for a Comet contract.

### **Public Functions**
- `migrate()`: Main entry point for position migration.
- `uniswapV3FlashCallback()`: Callback function for Uniswap V3 flash loans.

---

## 🛠️ Frontend Responsibilities
- **Provide Full Routes and Amounts**: The frontend must calculate and provide all the necessary routes, swap paths, amounts, and addresses for migration.
- **Token Approvals**: The user must approve the MigratorV2 contract for all collateral and debt tokens. This approval is essential for the contract to access the user’s tokens.
- **Drop Unsupported Collateral**: If the target protocol does not support a collateral type, the frontend can instruct the contract to drop that collateral.

---

## 📝 License
This project is licensed under the **MIT License**.
