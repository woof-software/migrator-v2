// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NegativeTesting} from "../NegativeTesting.sol";

interface IERC20Mintable {
    function mint(address account, uint256 amount) external;
}

interface IERC20Burnable {
    function burn(address account, uint256 amount) external;
}

contract MockSparkPool is NegativeTesting {
    address public constant NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    mapping(address => IERC20) public spToken;
    mapping(address => IERC20) public spDebtToken;

    constructor(address _spToken, address _token, address _spDebtToken, address _debtToken) {
        setPoll(_spToken, _token, _spDebtToken, _debtToken);
    }

    function setPoll(address _spToken, address _token, address _spDebtToken, address _debtToken) public {
        require(_spToken != address(0) || _spDebtToken != address(0), "Invalid underlying asset address");
        spToken[_token] = IERC20(_spToken);
        spDebtToken[_debtToken] = IERC20(_spDebtToken);
    }

    function deposit(address asset, uint256 amount) external payable {
        address _spToken = address(spToken[asset]);

        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        IERC20Mintable(_spToken).mint(msg.sender, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        address _spToken = address(spToken[asset]);

        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20Burnable(_spToken).burn(msg.sender, amount);
            IERC20(asset).transfer(to, amount);
        }

        return amount;
    }

    function borrow(address asset, uint256 amount) external {
        address _spDebtToken = address(spDebtToken[asset]);

        IERC20Mintable(_spDebtToken).mint(msg.sender, amount);
        if (asset == NATIVE_TOKEN_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed.");
        } else {
            IERC20(asset).transfer(msg.sender, amount);
        }
    }

    function repay(address asset, uint256 amount, uint256 /*rateMode*/, address onBehalfOf) external returns (uint256) {
        address _spDebtToken = address(spDebtToken[asset]);

        IERC20Burnable(_spDebtToken).burn(onBehalfOf, amount);

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
        IERC20 _spDebtToken = spDebtToken[asset];

        return (
            0,
            (negativeTest == NegativeTest.DebtNotCleared ? 1 : _spDebtToken.balanceOf(user)),
            (negativeTest == NegativeTest.DebtNotCleared ? 1 : _spDebtToken.balanceOf(user)),
            0,
            0,
            0,
            0,
            0,
            true
        );
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
