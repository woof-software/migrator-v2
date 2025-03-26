// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MorphoUsdsAdapter} from "../../../contracts/adapters/MorphoUsdsAdapter.sol";

contract TestMorphoUsdsAdapter is MorphoUsdsAdapter {
    bool public immutable IS_TEST_DEPLOYMENT;

    constructor(DeploymentParams memory deploymentParams) MorphoUsdsAdapter(deploymentParams) {
        IS_TEST_DEPLOYMENT = true;
    }
}
