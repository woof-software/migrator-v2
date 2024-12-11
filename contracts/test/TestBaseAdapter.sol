// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseAdapter} from "../BaseAdapter.sol";

contract TestBaseAdapter is BaseAdapter {
    constructor(
        address _uniswapRouter,
        address _daiUsdsConverter,
        address _dai,
        address _usds,
        address _wrappedNativeToken
    ) BaseAdapter(_uniswapRouter, _daiUsdsConverter, _dai, _usds, _wrappedNativeToken) {}
}
