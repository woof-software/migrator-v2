// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockAToken} from "../aave/MockAToken.sol";

contract MockSpToken is MockAToken {
    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_
    ) MockAToken(name_, symbol_, underlying_) {}
}
