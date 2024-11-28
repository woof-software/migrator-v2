// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IWrappedToken
 * @notice Interface for Wrapped Native Tokens (e.g., WETH, WMATIC, WBNB).
 */
interface IWrappedToken {
    /**
     * @notice Deposits native tokens and mints wrapped tokens.
     * @dev Equivalent to wrapping native tokens.
     */
    function deposit() external payable;

    /**
     * @notice Burns wrapped tokens and withdraws native tokens.
     * @dev Equivalent to unwrapping wrapped tokens.
     * @param amount The amount of wrapped tokens to burn and withdraw as native tokens.
     */
    function withdraw(uint256 amount) external;

    /**
     * @notice Returns the balance of wrapped tokens held by an address.
     * @param account The address to query the balance of.
     * @return balance The balance of wrapped tokens.
     */
    function balanceOf(address account) external view returns (uint256 balance);
}
