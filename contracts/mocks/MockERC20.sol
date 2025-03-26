// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    event TransferDEV(address token, string symbol);

    /**
     * @notice Constructor that mints `initialSupply` tokens to `owner`.
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @param initialSupply Initial total supply to mint to the `owner` address
     * @param owner The address that will receive the entire initial supply
     */
    constructor(string memory name, string memory symbol, uint256 initialSupply, address owner) ERC20(name, symbol) {
        require(owner != address(0), "Invalid owner address");
        _mint(owner, initialSupply);
    }

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    function mintFor(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFor(address account, uint256 amount) external {
        _burn(account, amount);
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        emit TransferDEV(address(this), symbol());
        return super.transfer(recipient, amount);
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        emit TransferDEV(address(this), symbol());
        return super.transferFrom(sender, recipient, amount);
    }
}
