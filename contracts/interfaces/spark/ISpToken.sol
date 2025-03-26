// SPDX-License-Identifier: MIT

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

pragma solidity 0.8.28;

interface ISpToken is IERC20 {
  /**
   * @dev Returns the address of the underlying asset of this spToken (E.g. WETH for spWETH)
   **/
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}