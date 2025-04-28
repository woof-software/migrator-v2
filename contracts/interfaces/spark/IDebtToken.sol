// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDebtToken {
    /**
     * @notice Updates the borrow allowance of a user on the specific debt token.
     * @param delegatee The address receiving the delegated borrowing power
     * @param amount The allowance amount being delegated.
     */
    function approveDelegation(address delegatee, uint256 amount) external;

    /**
     * @notice Returns the address of the underlying asset of this debtToken (E.g. WETH for debtWETH)
     * @return The address of the underlying asset
     */
    function UNDERLYING_ASSET_ADDRESS() external view returns (IERC20);
}
