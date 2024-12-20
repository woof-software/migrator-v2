// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Mintable {
    function mint(address account, uint256 amount) external;
}

interface IERC20Burnable {
    function burn(address account, uint256 amount) external;
}

contract MockAavePool {
    address public constant NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    IERC20 public aToken;
    IERC20 public aDebtToken;

    constructor(address _aToken, address _aDebtToken) {
        require(_aToken != address(0) || _aDebtToken != address(0), "Invalid underlying asset address");
        aToken = IERC20(_aToken);
        aDebtToken = IERC20(_aDebtToken);
    }

    function deposit(address /*asset*/, uint256 amount) external payable {
        IERC20Mintable(address(aToken)).mint(msg.sender, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20Burnable(address(aToken)).burn(msg.sender, amount);
            IERC20(asset).transfer(to, amount);
        }

        return amount;
    }

    function borrow(address asset, uint256 amount) external {
        IERC20Mintable(address(aDebtToken)).mint(msg.sender, amount);
        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20(asset).transfer(msg.sender, amount);
        }
    }

    function repay(
        address /*asset*/,
        uint256 amount,
        uint256 /*rateMode*/,
        address onBehalfOf
    ) external returns (uint256) {
        IERC20Burnable(address(aDebtToken)).burn(onBehalfOf, amount);
        return amount;
    }

    function getUserReserveData(
        address /*asset*/,
        address user
    )
        external
        view
        returns (
            uint256 currentATokenBalance,
            uint256 currentStableDebt,
            uint256 currentVariableDebt,
            uint256 principalStableDebt,
            uint256 scaledVariableDebt,
            uint256 stableBorrowRate,
            uint256 liquidityRate,
            uint40 stableRateLastUpdated,
            bool usageAsCollateralEnabled
        )
    {
        return (aToken.balanceOf(user), aDebtToken.balanceOf(user), 0, 0, 0, 0, 0, 0, true);
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
