// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockADebtToken} from "../aave/MockADebtToken.sol";

contract MockSpDebtToken is MockADebtToken {
    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_
    ) MockADebtToken(name_, symbol_, underlying_) {}
}
