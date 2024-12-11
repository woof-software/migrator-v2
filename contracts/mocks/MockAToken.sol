// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;

    /**
     * @param name_ The ERC20 name of the aToken
     * @param symbol_ The ERC20 symbol of the aToken
     * @param underlying_ The address of the underlying asset for this aToken
     */
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
