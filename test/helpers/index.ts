import {
    loadFixture,
    takeSnapshot,
    time,
    mine,
    SnapshotRestorer,
    impersonateAccount,
    stopImpersonatingAccount,
    setBalance
} from "@nomicfoundation/hardhat-network-helpers";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { anyUint, anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";
import { BigNumber, providers } from "ethers";

if (!process.env.npm_config_debug_log) {
    import("dotenv").then((dotenv) => dotenv.config());
}

const { Zero, One, AddressZero, HashZero, MaxUint256 } = ethers.constants;
const { parseEther, parseUnits, formatEther, formatUnits, solidityPack } = ethers.utils;

export const logger = (...args: any[]) => process.env.npm_config_debug_log === "true" && console.log("[DEBUG]", ...args);

export async function findSlotForVariable(contractName: string, variableName: string): Promise<BigNumber | undefined> {
    const artifact = await hre.artifacts.readArtifact(contractName);
    const buildInfo = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${contractName}`);
    if (!buildInfo) {
        console.error(`Build info for ${contractName} not found`);
        return;
    }

    const layout = (buildInfo.output.contracts[artifact.sourceName][contractName] as any).storageLayout;
    const entry = layout.storage.find((s: any) => s.label === variableName);
    if (!entry) {
        console.error(`Variable ${variableName} not found`);
        return;
    }

    const slot: string = entry.slot;
    // console.log(`Slot for ${variableName}:`, slot);

    return BigNumber.from(slot);
}
export async function getStorage(
    slot: BigNumber,
    contractAddress: string,
    provider?: providers.JsonRpcProvider
): Promise<string> {
    if (!provider) {
        provider = hre.ethers.provider as providers.JsonRpcProvider;
    }

    const value = await provider.getStorageAt(contractAddress, slot);
    // console.log(`Value:`, value);

    return value;
}

export {
    SnapshotRestorer,
    loadFixture,
    takeSnapshot,
    expect,
    ethers,
    MaxUint256,
    Zero,
    HashZero,
    One,
    AddressZero,
    parseEther,
    parseUnits,
    formatEther,
    formatUnits,
    solidityPack,
    SignerWithAddress,
    BigNumber,
    time,
    mine,
    setBalance,
    anyUint,
    anyValue,
    impersonateAccount,
    stopImpersonatingAccount
};
