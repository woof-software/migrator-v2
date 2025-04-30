// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IUniswapV3FlashCallback} from "../interfaces/uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";

interface IFakeUniswapV3Pool {
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

contract FakeUniswapV3Pool is IFakeUniswapV3Pool {
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external {
        IUniswapV3FlashCallback(recipient).uniswapV3FlashCallback(0, 0, data);
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
