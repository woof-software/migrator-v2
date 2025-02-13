// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MigratorV2} from "../../contracts/MigratorV2.sol";

contract TestMigratorV2 is MigratorV2 {
    bool public immutable IS_TEST_DEPLOYMENT;

    constructor(
        address multisig,
        address[] memory adapters,
        address[] memory comets,
        FlashData[] memory flashData
    ) MigratorV2(multisig, adapters, comets, flashData) {
        IS_TEST_DEPLOYMENT = true;
    }
}
