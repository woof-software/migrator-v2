// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockComet {
    address public assetToken;
    address public collateralToken;

    mapping(address => mapping(address => uint256)) public userSupply;

    constructor(address _assetToken, address _collateralToken) {
        require(_assetToken != address(0), "Invalid asset token address");
        require(_collateralToken != address(0), "Invalid collateral token address");
        assetToken = _assetToken;
        collateralToken = _collateralToken;
    }

    /// -------------------- Supply / Withdraw / Collateral Balance --------------------

    function supplyTo(address dst, address asset, uint256 amount) public {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        userSupply[dst][asset] += amount;
    }

    function withdrawFrom(address src, address to, address asset, uint256 amount) public {
        require(userSupply[src][asset] >= amount, "Insufficient supply balance");
        userSupply[src][asset] -= amount;
        IERC20(asset).transfer(to, amount);
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

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
