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

    mapping(address => IERC20) public aToken;
    mapping(address => IERC20) public aDebtToken;

    // IERC20 public aToken;
    // IERC20 public aDebtToken;

    constructor(address _aToken, address _token, address _aDebtToken, address _debtToken) {
        setPoll(_aToken, _token, _aDebtToken, _debtToken);
    }

    function setPoll(address _aToken, address _token, address _aDebtToken, address _debtToken) public {
        require(_aToken != address(0) || _aDebtToken != address(0), "Invalid underlying asset address");
        aToken[_token] = IERC20(_aToken);
        aDebtToken[_debtToken] = IERC20(_aDebtToken);
    }

    function deposit(address asset, uint256 amount) external payable {
        address _aToken = address(aToken[asset]);

        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        IERC20Mintable(_aToken).mint(msg.sender, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        address _aToken = address(aToken[asset]);

        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20Burnable(_aToken).burn(msg.sender, amount);
            IERC20(asset).transfer(to, amount);
        }

        return amount;
    }

    function borrow(address asset, uint256 amount) external {
        address _aDebtToken = address(aDebtToken[asset]);

        IERC20Mintable(_aDebtToken).mint(msg.sender, amount);
        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20(asset).transfer(msg.sender, amount);
        }
    }

    function repay(address asset, uint256 amount, uint256 /*rateMode*/, address onBehalfOf) external returns (uint256) {
        address _aDebtToken = address(aDebtToken[asset]);

        IERC20Burnable(_aDebtToken).burn(onBehalfOf, amount);

        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20(asset).transferFrom(msg.sender, onBehalfOf, amount);
        }
        return amount;
    }

    function getUserReserveData(
        address asset,
        address user
    )
        external
        view
        returns (
            uint256,
            uint256 currentStableDebt,
            uint256 currentVariableDebt,
            uint256,
            uint256,
            uint256,
            uint256,
            uint40,
            bool
        )
    {
        IERC20 _aDebtToken = aDebtToken[asset];

        return (0, _aDebtToken.balanceOf(user), _aDebtToken.balanceOf(user), 0, 0, 0, 0, 0, true);
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
