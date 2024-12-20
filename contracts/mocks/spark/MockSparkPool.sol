// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockAavePool} from "../aave/MockAavePool.sol";

contract MockSparkPool is MockAavePool {
    constructor(address _spToken, address _spDebtToken) MockAavePool(_spToken, _spDebtToken) {}
}
