# UniswapV3PathFinder Documentation

## Overview

The `UniswapV3PathFinder` contract provides functionality to find the best swap paths using Uniswap V3. It interacts with Uniswap V3's `QuoterV2` and `Factory` contracts to determine the most optimal single and multi-hop swap routes.

## Constants and Storage Variables

-   `DAI`: Immutable address of the DAI token.
-   `USDS`: Immutable address of the USDS token.
-   `FACTORY`: Immutable address of the Uniswap V3 Factory contract.
-   `QUOTER_V2`: Immutable address of the Uniswap V3 Quoter V2 contract.
-   `availableFeeTiers`: List of available Uniswap V3 fee tiers (`100`, `500`, `3000`, `10000`).

## Data Structures

### `QuoteSwapParams`

-   `path`: Encoded swap path.
-   `amountIn`: Amount of input tokens.
-   `amountOut`: Amount of output tokens.
-   `maxGasEstimate`: Maximum gas estimate for the swap.

### `SingleSwapParams`

-   `tokenIn`: Address of the input token.
-   `tokenOut`: Address of the output token.
-   `amountIn`: Amount of input tokens.
-   `amountOut`: Amount of output tokens.
-   `excludedPool`: Address of a pool to be excluded from swapping.
-   `maxGasEstimate`: Maximum gas estimate allowed.

### `MultiSwapParams`

-   `tokenIn`: Address of the input token.
-   `tokenOut`: Address of the output token.
-   `connectors`: Array of intermediate tokens.
-   `amountIn`: Amount of input tokens.
-   `amountOut`: Amount of output tokens.
-   `excludedPool`: Address of a pool to be excluded.
-   `maxGasEstimate`: Maximum gas estimate allowed.

## Errors

-   `InvalidZeroAddress`: Thrown when an address is zero.
-   `SwapPoolsNotFound`: Thrown when no swap pools are found.
-   `MustBeAtLeastOneConnector`: Thrown when no connector tokens are provided.
-   `MustBeSetAmountInOrAmountOut`: Thrown when neither `amountIn` nor `amountOut` is specified.
-   `OnlyOneAmountMustBeSet`: Thrown when both `amountIn` and `amountOut` are specified.
-   `MustBeSetMaxGasEstimate`: Thrown when `maxGasEstimate` is not set.
-   `InvalidConfiguration`: Thrown for an invalid contract configuration.

## Constructor

### `constructor(address _factory, address _quoterV2, address _dai, address _usds)`

-   Initializes the contract with Uniswap V3 Factory and QuoterV2 addresses, along with DAI and USDS token addresses.
-   Reverts with `InvalidZeroAddress` if `_factory` or `_quoterV2` is zero.
-   Reverts with `InvalidConfiguration` if `_dai` and `_usds` are not properly configured.

## Functions

### `getBestSingleSwapPath(SingleSwapParams memory params)`

-   Finds the best single-hop swap path based on given parameters.
-   Returns:
    -   `path`: Encoded swap path.
    -   `estimatedAmount`: Estimated output amount.
    -   `gasEstimate`: Estimated gas required for the swap.
-   Reverts with `SwapPoolsNotFound` if no suitable swap pools are found.

### `getBestMultiSwapPath(MultiSwapParams memory params)`

-   Finds the best multi-hop swap path based on given parameters.
-   Returns:
    -   `path`: Encoded swap path.
    -   `estimatedAmount`: Estimated output amount.
    -   `gasEstimate`: Estimated gas required for the swap.
-   Reverts with `MustBeAtLeastOneConnector` if no connector tokens are provided.
-   Reverts with `SwapPoolsNotFound` if no suitable swap pools are found.

## How to Use

### Querying Swap Estimates with `quoteExactInput` and `quoteExactOutput`

-   The function `_quoteSwap` determines which type of query to perform based on the parameters provided:
    -   If `amountIn > 0`, the contract uses `quoteExactInput`, which estimates the output amount for a given input.
    -   If `amountOut > 0`, the contract uses `quoteExactOutput`, which estimates the required input to receive a specific output.
-   **Important:** The values of `amountIn` and `amountOut` cannot both be greater than zero at the same time. If both are set, the contract will revert with `OnlyOneAmountMustBeSet`.

### Difference Between `getBestSingleSwapPath` and `getBestMultiSwapPath`

-   `getBestSingleSwapPath`: Finds the best direct swap path between two tokens using Uniswap V3 pools.
-   `getBestMultiSwapPath`: Finds the best swap path by including intermediary tokens to achieve better price execution.

### Special Case: DAI to USDS Swaps

-   The contract handles swaps between `DAI` and `USDS` differently from other tokens.
-   Instead of performing a Uniswap swap, the contract recognizes that DAI and USDS can be directly converted and returns a **conversion path** instead of a swap path.
-   **Differences between swap path and conversion path:**
    -   A **swap path** includes fee tiers and may involve multiple liquidity pools.
    -   A **conversion path** is a direct representation of the token exchange and **does not include fee tiers**.
    -   The conversion path is always linear (left to right), ensuring direct mapping from `DAI` to `USDS` or vice versa.
-   This optimization reduces gas costs and improves efficiency for users performing DAI-USDS conversions.

## Summary

The `UniswapV3PathFinder` contract efficiently finds the best swap paths using Uniswap V3 pools. It supports both single and multi-hop swaps and includes error handling mechanisms for invalid inputs and missing pools. The contract leverages Uniswap V3's QuoterV2 to fetch real-time price estimates and uses an optimized path selection strategy for gas efficiency. Additionally, it optimizes DAI to USDS conversions by bypassing Uniswap swaps when a direct conversion is possible.
