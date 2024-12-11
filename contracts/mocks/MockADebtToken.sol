// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockADebtToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    uint256 public constant DEBT_TOKEN_REVISION = 1;

    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_
    ) ERC20(name_, symbol_) {
        require(underlying_ != address(0), "Invalid underlying asset address");
        UNDERLYING_ASSET_ADDRESS = underlying_;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        // _burn(account, amount);
        _update(account, address(0), amount);
    }
}
