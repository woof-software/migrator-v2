import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "../utils/helpers";
const { ethers, network } = hre;

const CONTRACT_NAME = "TestAaveV3Adapter";
const FILE_NAME = "deploymentAddresses";
const PATH_TO_FILE = path.join(__dirname, `./${FILE_NAME}.json`);

// Use the network name to get the config.
// const args = {
//     uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
//     wrappedNativeToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
//     aaveLendingPool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
//     aaveDataProvider: "0x7F23D86Ee20D869112572136221e173428DD740B",
//     isFullMigration: true
// };

async function deploy() {
    const [deployer] = await ethers.getSigners();

    const config = process.env.npm_config_args_network;
    const args = nodeConfig.util.toObject(nodeConfig.get("deploymentParams"))[config || "hardhat"].TestAaveV3Adapter;

    console.log("\n --- Deployed data --- \n");
    console.log("* ", deployer.address, "- Deployer address");
    console.log("* ", hre.network.name, "- Network name");
    console.log("* ", CONTRACT_NAME, "- Contract name");
    console.log("* Arguments: ", args);
    console.log("\n --- ------- ---- --- ");

    const Contract = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = await Contract.connect(deployer).deploy(args);
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
    await verify(contract.address, [args]);
    // await verify("", [args]);
    console.log("\nDone.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
