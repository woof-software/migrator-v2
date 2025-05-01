// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract MockComet {
    address public assetToken;
    address public collateralToken;

    uint256 private _baseBorrowMin = 1; // 1 token

    mapping(address => mapping(address => uint256)) public userSupply;
    mapping(address => mapping(address => uint256)) public userBorrow;

    constructor(address _assetToken, address _collateralToken) {
        require(_assetToken != address(0), "Invalid asset token address");
        require(_collateralToken != address(0), "Invalid collateral token address");
        assetToken = _assetToken;
        collateralToken = _collateralToken;
    }

    /// -------------------- Supply / Withdraw / Collateral Balance --------------------

    function supplyTo(address dst, address asset, uint256 amount) public {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);

        uint256 borrowBalance = userBorrow[dst][asset];
        uint256 supplyAmount = amount;

        if (borrowBalance > 0) {
            uint256 repayAmount = borrowBalance > amount ? amount : borrowBalance;
            userBorrow[dst][asset] -= repayAmount;
            supplyAmount -= repayAmount;
        }

        userSupply[dst][asset] += supplyAmount;
    }

    function supply(address asset, uint256 amount) public {
        address src = msg.sender;
        IERC20(asset).transferFrom(src, address(this), amount);

        uint256 borrowBalance = userBorrow[src][asset];
        uint256 supplyAmount = amount;

        if (borrowBalance > 0) {
            uint256 repayAmount = amount > borrowBalance ? amount - borrowBalance : amount;
            userBorrow[src][asset] -= repayAmount;
            supplyAmount -= repayAmount;
        }

        userSupply[src][asset] += supplyAmount;
    }

    function withdrawFrom(address src, address to, address asset, uint256 amount) public {
        uint256 supplyBalance = userSupply[src][asset];
        uint256 borrowAmount = supplyBalance < amount ? amount - supplyBalance : 0;

        userSupply[src][asset] -= amount - borrowAmount;
        userBorrow[src][asset] += borrowAmount;

        IERC20(asset).transfer(to, amount);
    }

    function withdraw(address asset, uint256 amount) public {
        address src = msg.sender;

        uint256 supplyBalance = userSupply[src][asset];
        uint256 borrowAmount = supplyBalance < amount ? amount - supplyBalance : 0;

        userSupply[src][asset] -= amount - borrowAmount;
        userBorrow[src][asset] += borrowAmount;

        IERC20(asset).transfer(src, amount);
    }

    function collateralBalanceOf(address user, address collateral) public view returns (uint256) {
        return userSupply[user][collateral];
    }

    function baseToken() external view returns (address) {
        return assetToken;
    }

    function balanceOf(address user) public view returns (uint256) {
        return userSupply[user][assetToken];
    }

    function baseBorrowMin() external view returns (uint256) {
        uint8 decimals = IERC20Metadata(assetToken).decimals();
        return _baseBorrowMin * 10 ** decimals;
    }

    function setBaseBorrowMin(uint256 minAmount) external {
        _baseBorrowMin = minAmount;
    }

    function borrowBalanceOf(address user) public view returns (uint256) {
        return userBorrow[user][assetToken];
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
