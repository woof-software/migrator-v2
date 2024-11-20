// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IProtocolAdapter} from "./interfaces/IProtocolAdapter.sol";
import {IUniswapV3FlashCallback} from "./interfaces/@uniswap/v3-core/callback/IUniswapV3FlashCallback.sol";
import {IUniswapV3Pool} from "./interfaces/@uniswap/v3-core/IUniswapV3Pool.sol";

contract MigratorV2 is IUniswapV3FlashCallback, Ownable, ReentrancyGuard {
    /// --------State Variables-------- ///

    address public immutable BASE_TOKEN;
    address public immutable UNISWAP_LIQUIDITY_POOL;
    bool public immutable IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0;

    mapping(address => bool) public allowedAdapters;

    /// --------Errors-------- ///

    error Reentrancy(uint256 loc);
    error InvalidAdapter(uint256 loc);
    error InsufficientRepayment(uint256 loc);
    error AdapterNotAllowed(address loc);

    /// --------Events-------- ///

    event AdapterExecuted(
        address indexed adapter,
        address indexed user,
        uint256 flashAmount,
        uint256 flashAmountWithFee
    );

    constructor(
        address _baseToken,
        address _uniswapLiquidityPool,
        bool _isToken0
    ) Ownable(msg.sender) ReentrancyGuard() {
        BASE_TOKEN = _baseToken;
        UNISWAP_LIQUIDITY_POOL = _uniswapLiquidityPool;
        IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0 = _isToken0;
    }

    /// --------Functions-------- ///

    function migrate(
        address adapter,
        uint256 flashAmount,
        bytes calldata migrationData
    ) external nonReentrant {
        if (!allowedAdapters[adapter]) revert AdapterNotAllowed(adapter);

        bytes memory callbackData = abi.encode(adapter, msg.sender, migrationData, flashAmount);

        IUniswapV3Pool(UNISWAP_LIQUIDITY_POOL).flash(address(this), flashAmount, 0, callbackData);
    }

    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        _uniswapV3FlashCallback(fee0, fee1, data);
    }

    function setAllowedAdapter(address adapter, bool allowed) external onlyOwner {
        allowedAdapters[adapter] = allowed;
    }

    function _uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) private nonReentrant {
        if (msg.sender != UNISWAP_LIQUIDITY_POOL) revert InvalidAdapter(0);

        (address adapter, address user, bytes memory migrationData, uint256 flashAmount) = abi
            .decode(data, (address, address, bytes, uint256));

        uint256 flashAmountWithFee = flashAmount +
            (IS_UNISWAP_LIQUIDITY_POOL_TOKEN_0 ? fee0 : fee1);

        IProtocolAdapter(adapter).executeMigration(user, migrationData);

        if (IERC20(BASE_TOKEN).balanceOf(address(this)) < flashAmountWithFee) {
            revert InsufficientRepayment(0);
        }

        IERC20(BASE_TOKEN).transfer(msg.sender, flashAmountWithFee);

        emit AdapterExecuted(adapter, user, flashAmount, flashAmountWithFee);
    }
}
