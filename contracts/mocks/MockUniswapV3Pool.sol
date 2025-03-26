// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IUniswapV3FlashCallback} from "../interfaces/@uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUniswapV3Pool {
    address public token0;
    address public token1;
    constructor(address _token0, address _token1) {
        require(_token0 != address(0), "Invalid token0 address");
        require(_token1 != address(0), "Invalid token1 address");
        token0 = _token0;
        token1 = _token1;
    }

    /**
     * @notice Mocks the flash operation, sending requested tokens to the recipient and expecting repayment plus fee in the callback.
     * @dev In a real Uniswap V3 pool, the flash fee is calculated based on the pool’s liquidity and other factors.
     *      Here, we do not calculate a fee and simply expect the caller to return tokens plus a fee they define.
     * @param recipient The address receiving the tokens.
     * @param amount0 The amount of token0 to flash.
     * @param amount1 The amount of token1 to flash.
     * @param data Arbitrary data that will be passed to the flash callback.
     */
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external {
        // Transfer token0 and/or token1 to the recipient
        if (amount0 > 0) {
            IERC20(token0).transfer(recipient, amount0);
        }
        if (amount1 > 0) {
            IERC20(token1).transfer(recipient, amount1);
        }

        // Call the flash callback on the recipient
        uint256 fee0 = (amount0 * 3) / 10000; // simulate a small fee, e.g. 0.03%
        uint256 fee1 = (amount1 * 3) / 10000;

        // The recipient should implement the flash callback
        IUniswapV3FlashCallback(recipient).uniswapV3FlashCallback(fee0, fee1, data);

        // Verify that the recipient returned the flash loaned amounts plus fee
        if (amount0 > 0) {
            uint256 bal0 = IERC20(token0).balanceOf(address(this));
            require(bal0 >= amount0 + fee0, "Flash loan not repaid token0");
        }
        if (amount1 > 0) {
            uint256 bal1 = IERC20(token1).balanceOf(address(this));
            require(bal1 >= amount1 + fee1, "Flash loan not repaid token1");
        }
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
