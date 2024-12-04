// SPDX-License-Identifier: MIT

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

pragma solidity 0.8.28;

interface IADebtToken is IERC20 {
    /**
     * @notice Updates the borrow allowance of a user on the specific debt token.
     * @param delegatee The address receiving the delegated borrowing power
     * @param amount The allowance amount being delegated.
     */
    function approveDelegation(address delegatee, uint256 amount) external;

    /**
     * @dev Returns the revision of the debt token contract
     **/
    function DEBT_TOKEN_REVISION() external view returns (uint256);

    /**
     * @dev Returns the address of the underlying asset of this aToken (E.g. WETH for aWETH)
     **/
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}
