// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UniswapV3PathFinder} from "../../../contracts/utils/UniswapV3PathFinder.sol";

contract TestUniswapV3PathFinder is UniswapV3PathFinder {
    bool public immutable IS_TEST_DEPLOYMENT;

    constructor(address _factory, address _quoterV2) UniswapV3PathFinder(_factory, _quoterV2) {
        IS_TEST_DEPLOYMENT = true;
    }
}
