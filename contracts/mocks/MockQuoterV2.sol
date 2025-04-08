// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.28;

import {NegativeTesting} from "./NegativeTesting.sol";

interface IQuoterV2 {
    function quoteExactInput(
        bytes memory path,
        uint256 amountIn
    )
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );

    function quoteExactOutput(
        bytes memory path,
        uint256 amountOut
    )
        external
        returns (
            uint256 amountIn,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

contract MockQuoterV2 is IQuoterV2, IUniswapV3Factory, NegativeTesting {
    address public constant NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function getPool(
        address /*tokenA*/,
        address /*tokenB*/,
        uint24 /*fee*/
    ) external view override returns (address pool) {
        if (negativeTest == NegativeTest.InvalidPoll) {
            return address(0);
        }
        return address(1);
    }

    function quoteExactInput(
        bytes memory path,
        uint256 amountIn
    )
        external
        pure
        override
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        )
    {
        (uint256 fee1, uint256 fee2) = _decodePoolFeeFromPath(path);

        if (fee1 == 3000) {
            amountOut = (amountIn * 105) / 100;
        } else {
            amountOut = amountIn;
        }
        return (amountOut, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate);
    }

    function quoteExactOutput(
        bytes memory path,
        uint256 amountOut
    )
        external
        pure
        override
        returns (
            uint256 amountIn,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        )
    {
        (uint256 fee1, uint256 fee2) = _decodePoolFeeFromPath(path);

        if (fee1 == 3000 || fee2 == 3000) {
            amountIn = (amountOut * 95) / 100;
        } else {
            amountIn = amountOut;
        }

        return (amountIn, sqrtPriceX96AfterList, initializedTicksCrossedList, gasEstimate);
    }

    function _decodePoolFeeFromPath(bytes memory path) internal pure returns (uint24 fee1, uint24 fee2) {
        assembly {
            fee1 := mload(add(path, 23))
            fee2 := mload(add(path, 46))
        }
    }
}
