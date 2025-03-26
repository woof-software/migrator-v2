// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MorphoAdapter} from "../../../contracts/adapters/MorphoAdapter.sol";

contract TestMorphoAdapter is MorphoAdapter {
    bool public immutable IS_TEST_DEPLOYMENT;

    constructor(DeploymentParams memory deploymentParams) MorphoAdapter(deploymentParams) {
        IS_TEST_DEPLOYMENT = true;
    }
}
