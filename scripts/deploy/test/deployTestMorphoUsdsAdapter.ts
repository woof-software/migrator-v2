import * as dotenv from "dotenv";
dotenv.config();

import nodeConfig from "config";
import hre from "hardhat";
import path from "path";
import { getAddressSaver, verify } from "../utils/helpers";
const { ethers, network } = hre;

import { MigratorV2__factory } from "../../../typechain-types";

const CONTRACT_NAME: string = "TestMorphoUsdsAdapter";
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

    // const config = nodeConfig.util.toObject(nodeConfig.get("deploymentParams"))[
    //     process.env.npm_config_args_network || "hardhat"
    // ];
    // const args = config[CONTRACT_NAME];
    // console.log("Block number:", await ethers.provider.getBlockNumber());

    // console.log("\n --- Deployed data --- \n");
    // console.log("* ", deployer.address, "- Deployer address");
    // console.log("* ", hre.network.name, "- Network name");
    // console.log("* ", CONTRACT_NAME, "- Contract name");
    // console.log("* Arguments: ", args);
    // console.log("\n --- ------- ---- --- ");

    // const Contract = await ethers.getContractFactory(CONTRACT_NAME);
    // const contract = await Contract.connect(deployer).deploy(args);
    // const deployTransaction = (await contract.deployed()).deployTransaction.wait();

    // console.log(`Contract: \`${CONTRACT_NAME}\` is deployed to \`${contract.address}\`|\`${hre.network.name}\`.`);
    // const saveAddress = getAddressSaver(PATH_TO_FILE, network.name, true);
    // saveAddress(
    //     CONTRACT_NAME,
    //     {
    //         address: contract.address,
    //         deployedBlock: (await deployTransaction).blockNumber,
    //         chainId: ethers.provider.network.chainId
    //     },
    //     false
    // );

    // console.log("\nDeployment is completed.");
    // await verify(contract.address, [args]);
    // console.log("\nDone.");

    // For Ethereum mainnet, the address is "0xd4c88B769043C4f43D3f79842C7D7Bb82411A34e".
    // // Add the address to the Migration contract.
    // console.log("Adding the adapter to the Migration contract...");
    const migration = MigratorV2__factory.connect("0x0ef2c369A5c5EbFe06C6a54276206b076319c99f", deployer);
    // await migration.setAdapter(contract.address);
    // await migration.setAdapter("0x1EFe17A612D9D64075bC77A403D246b858b800ab");
    // console.log("owner: ", await migration.owner());
    // console.log("Adapter is added to the Migration contract.");

    // Delete the address from the Migration contract.
    console.log("Removing the adapter from the Migration contract...");
    const contract = "0xd55b9e59bFf3b2dE058e95825066C661e7348b2e";
    await migration.removeAdapter(contract);
    console.log(`Adapter is removed from the Migration contract: ${contract}`);
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
