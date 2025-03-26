import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "../utils/helpers";
const { ethers, network } = hre;

const CONTRACT_NAME = "TestUniswapV3PathFinder";
const FILE_NAME = "deploymentAddresses";
const PATH_TO_FILE = path.join(__dirname, `./${FILE_NAME}.json`);

// Use the network name to get the config.
// const args = {
// "factory": "0x0",
// "quoterV2": "0x0",
// "dai": "0x0",
// "usds": "0x0"
// };

async function deploy() {
    const [deployer] = await ethers.getSigners();

    const config = process.env.npm_config_args_network;
    const args = nodeConfig.util.toObject(nodeConfig.get("deploymentParams"))[config || "hardhat"][CONTRACT_NAME];

    console.log("\n --- Deployed data --- \n");
    console.log("* ", deployer.address, "- Deployer address");
    console.log("* ", hre.network.name, "- Network name");
    console.log("* ", CONTRACT_NAME, "- Contract name");
    console.log("* Arguments: ", args);
    console.log("\n --- ------- ---- --- ");

    const Contract = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = await Contract.connect(deployer).deploy(args.factory, args.quoterV2, args.dai, args.usds);
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
    await verify(contract.address, [args.factory, args.quoterV2, args.dai, args.usds]);
    console.log("\nDone.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
