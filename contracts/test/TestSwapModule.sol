// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SwapModule} from "../SwapModule.sol";

contract TestSwapModule is SwapModule {
    constructor(address _uniswapRouter) SwapModule(_uniswapRouter) {}

}