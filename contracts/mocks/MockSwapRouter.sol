// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapRouter} from "../interfaces/uniswap/v3-periphery/ISwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NegativeTesting} from "./NegativeTesting.sol";

interface IAdapter {
    function executeMigration(
        address user,
        address comet,
        bytes calldata migrationData,
        bytes calldata flashloanData
    ) external;
}

/**
 * @title MockSwapRouter
 * @notice A mock implementation of the Uniswap V3 Swap Router for testing purposes.
 * @dev This mock does not perform actual price calculations or route through multiple pools.
 *      It assumes a 1:1 swap rate between tokens for simplicity.
 */
contract MockSwapRouter is ISwapRouter, NegativeTesting {
    address public constant NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    address public adapter;

    uint256 public dustAmount = 100;

    function setDustAmount(uint256 _dustAmount) external {
        dustAmount = _dustAmount;
    }

    function setAdapter(address _adapter) external {
        adapter = _adapter;
    }

    function _reentrant() internal {
        IAdapter(adapter).executeMigration(msg.sender, address(this), "", "");
    }

    /**
     * @notice Executes a swap given an exact input (amountIn) to get as much output as possible.
     * @dev For simplicity, we assume a 1:1 rate: amountOut = params.amountIn.
     * @param params The parameters necessary for the single-hop swap.
     * @return amountOut The amount of the received token.
     */
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        if (negativeTest == NegativeTest.SwapRouterNotSupported) {
            revert("Negative scenario");
        }

        if (negativeTest == NegativeTest.Reentrant) {
            _reentrant();
        }

        // Transfer tokenIn from caller
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        // Simulate a 1:1 swap
        amountOut = params.amountIn;

        // Transfer tokenOut to the recipient
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }

    /**
     * @notice Executes a multi-hop swap given an exact input (amountIn).
     * @dev For simplicity, we assume a single-hop scenario even though the interface supports multi-hop.
     *      We also use a 1:1 swap rate.
     * @param params The parameters necessary for the swap, including the path.
     * @return amountOut The amount of the received token.
     */
    function exactInput(ExactInputParams calldata params) external payable override returns (uint256 amountOut) {
        if (negativeTest == NegativeTest.SwapRouterNotSupported) {
            revert("Negative scenario: SwapRouter not supported");
        }

        if (negativeTest == NegativeTest.Reentrant) {
            _reentrant();
        }
        // Decode the path to get the input and output tokens
        (address tokenIn, address tokenOut) = _decodePath(params.path);

        // Transfer tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        // Assume 1:1 swap
        amountOut = params.amountIn;

        if (tokenOut == NATIVE_TOKEN_ADDRESS) {
            // Transfer ETH to the recipient
            (bool success, ) = params.recipient.call{value: amountOut}("");
            require(success, "ETH transfer failed");
        } else {
            // Transfer tokenOut to the recipient
            IERC20(tokenOut).transfer(params.recipient, amountOut);
        }
    }

    /**
     * @notice Executes a swap given an exact output (amountOut) by spending as little as possible of input.
     * @dev For simplicity, we assume amountIn = amountOut (1:1).
     * @param params The parameters necessary for the single-hop exact output swap.
     * @return amountIn The amount of the input token spent.
     */
    function exactOutputSingle(
        ExactOutputSingleParams calldata params
    ) external payable override returns (uint256 amountIn) {
        if (negativeTest == NegativeTest.SwapRouterNotSupported) {
            revert("Negative scenario: SwapRouter not supported");
        }

        if (negativeTest == NegativeTest.Reentrant) {
            _reentrant();
        }
        // amountIn = amountOut in our mock scenario
        amountIn = params.amountOut;

        // Transfer tokenIn from caller
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Transfer tokenOut to recipient
        IERC20(params.tokenOut).transfer(params.recipient, params.amountOut);
    }

    /**
     * @notice Executes a multi-hop swap given an exact output (amountOut), spending as little input as possible.
     * @dev For simplicity, assume a single-hop scenario and a 1:1 rate.
     * @param params The parameters necessary for the exact output multi-hop swap.
     * @return amountIn The amount of input tokens spent.
     */
    function exactOutput(ExactOutputParams calldata params) external payable override returns (uint256 amountIn) {
        if (negativeTest == NegativeTest.SwapRouterNotSupported) {
            revert("Negative scenario: SwapRouter not supported");
        }

        if (negativeTest == NegativeTest.Reentrant) {
            _reentrant();
        }

        (address tokenOut, address tokenIn) = _decodePath(params.path);

        IERC20[] memory connectorTokens = _decodeConnectorTokens(params.path);

        if (negativeTest == NegativeTest.Dust) {
            // Transfer dust to the recipient
            for (uint256 i = 0; i < connectorTokens.length; ++i) {
                IERC20(connectorTokens[i]).transfer(params.recipient, dustAmount);
            }

        }

        // amountIn = amountOut (1:1)
        amountIn = params.amountOut;
        // Transfer tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        // Transfer tokenOut to recipient
        IERC20(tokenOut).transfer(params.recipient, params.amountOut);
    }

    /**
     * @notice The Uniswap V3 Swap Callback function. Since this is a mock, we don't actually perform any callback logic.
     * @dev If a real swap callback were required, it would be implemented here.
     */
    function uniswapV3SwapCallback(
        int256 /*amount0Delta*/,
        int256 /*amount1Delta*/,
        bytes calldata /*data*/
    ) external pure override {
        // Not implemented in this mock.
        // In a real scenario, this callback would be triggered by the Uniswap pool
        // and is responsible for paying the pool tokens owed for the swap.
        revert("uniswapV3SwapCallback not implemented in mock");
    }

    /**
     * @notice Decodes the path to extract tokenIn and tokenOut.
     * @dev In a real multi-hop scenario, the path can be more complex. Here, we assume a single-hop path.
     * @param path The path bytes, which encodes the tokens involved in the swap.
     * @return tokenIn The address of the input token.
     * @return tokenOut The address of the output token.
     */
    function _decodePath(bytes memory path) internal pure returns (address tokenIn, address tokenOut) {
        // For a single-hop path, the format is: tokenIn(20 bytes) + fee(3 bytes) + tokenOut(20 bytes)
        // But since we are mocking, we can simplify and assume that the path is just tokenIn + tokenOut without fee.

        // Ensure path length is at least 40 bytes (20 for tokenIn + 20 for tokenOut)
        require(path.length >= 40, "Invalid path length");

        assembly {
            tokenIn := mload(add(path, 20))
            // tokenOut := mload(add(path, 40))
            let pathLength := mload(path)
            // Extract the last 20 bytes as tokenOut address
            tokenOut := mload(add(path, pathLength))
        }
    }

     function _decodeConnectorTokens(bytes memory path) internal pure returns (IERC20[] memory connectors) {
        uint256 pathLength = path.length;

        // Each hop = 20 (tokenIn) + 3 (fee) + 20 (tokenOut) = 43 bytes
        if (pathLength <= 43) {
            return new IERC20[](0); // Single path — no connectors
        }

        uint256 numConnectors = (pathLength - 43) / 23; // Calculate number of connectors
        connectors = new IERC20[](numConnectors);

        uint256 offset = 20; // skip tokenIn

        for (uint256 i = 0; i < numConnectors; ++i) {
            offset += 3; // skip fee
            address connector;
            assembly {
                // Read 32 bytes from path starting at offset and shift right by 96 bits to get the address (20 bytes)
                // 32 bytes = 256 bits, so we need to shift right by 256 - 160 = 96 bits
                connector := shr(96, mload(add(add(path, 32), offset)))
            }
            connectors[i] = IERC20(connector);
            offset += 20; // Move to next connector
        }
    }

    /**
     * @notice Allows the contract to receive the native token.
     */
    receive() external payable {}
}
