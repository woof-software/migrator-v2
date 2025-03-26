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
import { BigNumber } from "ethers";

if (!process.env.npm_config_debug_log) {
    import("dotenv").then((dotenv) => dotenv.config());
}

const { Zero, One, AddressZero, HashZero, MaxUint256 } = ethers.constants;
const { parseEther, parseUnits, formatEther, formatUnits, solidityPack } = ethers.utils;

export const log = (...args: any[]) => process.env.npm_config_debug_log === "true" && console.log("[DEBUG]", ...args);

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
