import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "./utils/helpers";
const { ethers, network } = hre;

const CONTRACT_NAME = "MigratorV2";
const FILE_NAME = "deploymentAddresses";
const PATH_TO_FILE = path.join(__dirname, `./${FILE_NAME}.json`);

async function deploy() {
    const [deployer] = await ethers.getSigners();
    const config = nodeConfig.util.toObject(nodeConfig.get("deploymentParams"))[
        process.env.npm_config_args_network || "hardhat"
    ];

    const args = config.TestMigratorV2;

    console.log("\n --- Deployed data --- \n");
    console.log("* ", deployer.address, "- Deployer address");
    console.log("* ", hre.network.name, "- Network name");
    console.log("* ", CONTRACT_NAME, "- Contract name");
    console.log("* Arguments: ", args);
    console.log("\n --- ------- ---- --- ");

    const Contract = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = await Contract.connect(deployer).deploy(args.multisig, args.adapters, args.comets, args.flashData);
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
    await verify(contract.address, [args.multisig, args.adapters, args.comets, args.flashData]);
    // await verify("", [args.multisig, args.adapters, args.comets, args.flashData]);
    console.log("\nDone.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
