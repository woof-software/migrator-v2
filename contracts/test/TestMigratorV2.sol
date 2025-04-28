// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MigratorV2} from "../../contracts/MigratorV2.sol";

contract TestMigratorV2 is MigratorV2 {
    bool public immutable IS_TEST_DEPLOYMENT;

    constructor(
        address multisig,
        address[] memory adapters,
        address[] memory comets,
        FlashData[] memory flashData,
        address dai,
        address usds
    ) MigratorV2(multisig, adapters, comets, flashData, dai, usds) {
        IS_TEST_DEPLOYMENT = true;
    }
}
