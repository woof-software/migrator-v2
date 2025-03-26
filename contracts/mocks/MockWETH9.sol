// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Interface for WETH9
interface IWETH9 {
    /// @notice Deposit ether to get wrapped ether
    function deposit() external payable;

    /// @notice Withdraw wrapped ether to get ether
    function withdraw(uint256) external;
}

/**
 * @title MockWrappedToken
 * @notice A mock implementation of a wrapped native token (e.g., WETH).
 * @dev This contract maintains a simple 1:1 correspondence between native tokens and its own ERC20 balance.
 *      Depositing native tokens mints new wrapped tokens, and burning wrapped tokens withdraws native tokens.
 */
contract MockWETH9 is ERC20, IWETH9 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 100_000 ether);
    }

    /**
     * @notice Deposits native tokens (e.g. ETH) and mints wrapped tokens to the caller.
     * @dev The amount of wrapped tokens minted equals the amount of native tokens sent.
     */
    function deposit() external payable override {
        require(msg.value > 0, "No native token provided");
        _mint(msg.sender, msg.value);
    }

    /**
     * @notice Burns wrapped tokens and withdraws the equivalent amount of native tokens.
     * @dev The caller must have at least `amount` wrapped tokens.
     * @param amount The amount of wrapped tokens to burn.
     */
    function withdraw(uint256 amount) external override {
        require(balanceOf(msg.sender) >= amount, "Insufficient wrapped token balance");
        _burn(msg.sender, amount);

        // Transfer native tokens back to the caller
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Native token transfer failed");
    }

    /**
     * @notice Fallback function to accept native tokens directly.
     * @dev If someone sends native tokens directly, it just sits in the contract balance.
     *      Users must call `deposit` to receive wrapped tokens.
     */
    receive() external payable {}
}
