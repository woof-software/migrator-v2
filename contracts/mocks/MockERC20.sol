// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {

    /**
     * @notice Constructor that mints `initialSupply` tokens to `owner`.
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @param initialSupply Initial total supply to mint to the `owner` address
     * @param owner The address that will receive the entire initial supply
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address owner
    ) ERC20(name, symbol) {
        require(owner != address(0), "Invalid owner address");
        _mint(owner, initialSupply);
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }
}
