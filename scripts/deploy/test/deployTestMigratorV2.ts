import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "../utils/helpers";
const { ethers, network } = hre;

const CONTRACT_NAME = "TestMigratorV2";
const FILE_NAME = "deploymentAddresses";
const PATH_TO_FILE = path.join(__dirname, `./${FILE_NAME}.json`);

// Use the network name to get the config.
const args = {
    multisig: "0x535163Ba9d4Bb7Fb510Ecf66eb890F2816B6B8b6",
    adapters: ["0x96d5e6C5821a384237673A4444ACf6721E4d9E1d"],
    comets: [
        "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", // Arbitrum - USDC.e Base (Bridged)
        "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", // Arbitrum - USDC Base (Native)
        "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486", // Arbitrum - WETH base
        "0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07" // Arbitrum - USDT base
    ],
    flashData: [
        {
            liquidityPool: "0x8e295789c9465487074a65b1ae9Ce0351172393f", // USDC / USDC.e
            baseToken: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC.e
            isToken0: false
        },
        {
            liquidityPool: "0x8e295789c9465487074a65b1ae9Ce0351172393f", // USDC / USDC.e
            baseToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
            isToken0: true
        },
        {
            liquidityPool: "0x641C00A822e8b671738d32a431a4Fb6074E5c79d", // WETH / USDT
            baseToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
            isToken0: true
        },
        {
            liquidityPool: "0x641C00A822e8b671738d32a431a4Fb6074E5c79d", // WETH / USDT
            baseToken: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // USDT
            isToken0: false
        }
    ]
};

async function deploy() {
    const [deployer] = await ethers.getSigners();
    const config = nodeConfig.util.toObject(nodeConfig.get("networks"))[network.name];

    console.log("\n --- Deployed data --- \n");
    console.log("* ", deployer.address, "- Deployer address");
    console.log("* ", hre.network.name, "- Network name");
    console.log("* ", CONTRACT_NAME, "- Contract name");
    console.log("\n --- ------- ---- --- ");

    const Contract = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = await Contract.connect(deployer).deploy(
        // config.multisig,
        // config.adapters,
        // config.comets,
        // config.flashData
        args.multisig,
        args.adapters,
        args.comets,
        args.flashData
    );
    const deployTransaction = (await contract.deployed()).deployTransaction.wait();

    console.log(`Contract: \`${CONTRACT_NAME}\` is deployed to \`${contract.address}\`|\`${hre.network.name}\`.`);
    const saveAddress = getAddressSaver(PATH_TO_FILE, network.name, true);
    saveAddress(
        CONTRACT_NAME,
        {
            address: contract.address,
            deployedBlock: (await deployTransaction).blockNumber,
            chainId: ethers.provider.network.chainId
        },
        false
    );

    console.log("\nDeployment is completed.");
    // await verify(contract.address, [config.multisig, config.adapters, config.comets, config.flashData]);
    await verify(contract.address, [args.multisig, args.adapters, args.comets, args.flashData]);
    console.log("\nDone.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
