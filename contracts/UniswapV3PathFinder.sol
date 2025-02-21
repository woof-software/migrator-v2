// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IQuoterV2 {
      function quoteExactInput(
    bytes memory path,
    uint256 amountIn
  ) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate);
}
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

contract UniswapV3PathFinder {
    
    uint256[] public availableFeeTiers = [100, 500, 3000, 10000];
    address public factory;
    address public quoterV2;

    constructor(address _factory, address _quoterV2) {
        factory = _factory;
        quoterV2 = _quoterV2;
    }

    function getBestSwapPath(
        address tokenIn,
        address tokenOut,
        address[] calldata connectors,
        uint256 amountIn,
        address[] calldata blacklist,
        uint256 maxGasEstimate
    ) external returns (bytes memory bestPath, uint256 bestAmountOut) {
        for (uint256 i = 0; i < connectors.length; i++) {
            address connector = connectors[i];
            (bytes memory path, uint256 amountOut) = _getBestSwapPath(tokenIn, tokenOut, connector, amountIn, blacklist, maxGasEstimate);
            if (amountOut > bestAmountOut) {
                bestPath = path;
                amountIn = amountOut;
            }
        }
    }

    function _getBestSwapPath(
        address tokenIn,
        address tokenOut,
        address connector,
        uint256 amountIn,
        address[] calldata blacklist,
        uint256 maxGasEstimate
    ) public returns (bytes memory path, uint256 amountOut) {
        (bytes memory bestPath1, uint256 bestAmountOut1) = getBestPool(tokenIn, connector, amountIn, blacklist, maxGasEstimate);
        
        if (bestAmountOut1 == 0) {
            return (new bytes(0), 0);
        }

        (bytes memory bestPath2, uint256 bestAmountOut2) = getBestPool(connector, tokenOut, bestAmountOut1, blacklist, maxGasEstimate);

        if (bestAmountOut2 == 0) {
            return (new bytes(0), 0);
        }

        path = abi.encodePacked(bestPath1, bestPath2);
        amountOut = bestAmountOut2;
    }

    function getBestPool(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address[] calldata blacklist,
        uint256 maxGasEstimate
    ) public returns (bytes memory bestPath, uint256 bestAmountOut) {
        bestAmountOut = 0;
        
        for (uint256 i = 0; i < availableFeeTiers.length; i++) {
            uint24 fee = uint24(availableFeeTiers[i]);
            address pool = IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, fee);

            if (pool == address(0) || isBlacklisted(pool, blacklist)) {
                continue;
            }

            (bytes memory path, uint256 amountOut) = getBestSinglePool(tokenIn, tokenOut, fee, amountIn, maxGasEstimate);

            if (amountOut > bestAmountOut) {
                bestAmountOut = amountOut;
                bestPath = path;
            }
        }
    }

    function isBlacklisted(address pool, address[] calldata blacklist) internal pure returns (bool) {
        for (uint256 i = 0; i < blacklist.length; i++) {
            if (pool == blacklist[i]) {
                return true;
            }
        }
        return false;
    }

    function getBestSinglePool(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 maxGasEstimate
    ) internal returns (bytes memory path, uint256 amountOut) {
        path = abi.encodePacked(tokenIn, tokenOut, fee);
        uint256 gasEstimate;
        
        (amountOut, , , gasEstimate) = IQuoterV2(quoterV2).quoteExactInput(path, amountIn);

        if (gasEstimate > maxGasEstimate && maxGasEstimate > 0) {
            amountOut = 0;
        }
    }
}