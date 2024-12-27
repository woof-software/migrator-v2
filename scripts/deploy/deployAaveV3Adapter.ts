import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "./utils/helpers";
const { ethers, network } = hre;

const CONTRACT_NAME = "AaveV3Adapter";
const FILE_NAME = "deploymentAddresses";
const PATH_TO_FILE = path.join(__dirname, `./${FILE_NAME}.json`);

// Use the network name to get the config.
const args = {
    uniswapRouter: "0x",
    daiUsdsConverter: "0x",
    dai: "0x",
    usdc: "0x",
    wrappedNativeToken: "0x",
    aavePool: "0x",
    aaveDataProvider: "0x"
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
    const contract = await Contract.connect(deployer).deploy({
        uniswapRouter: config.uniswapRouter,
        daiUsdsConverter: config.daiUsdsConverter,
        dai: config.dai,
        usds: config.usdc,
        wrappedNativeToken: config.wrappedNativeToken,
        aaveLendingPool: config.aavePool,
        aaveDataProvider: config.aaveDataProvider
    });
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
    await verify(contract.address, [
        config.uniswapRouter,
        config.daiUsdsConverter,
        config.dai,
        config.usdc,
        config.wrappedNativeToken,
        config.aavePool,
        config.aaveDataProvider
    ]);
    console.log("\nDone.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
