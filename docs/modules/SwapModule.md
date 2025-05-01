# Solidity API

## SwapModule

Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.

_Designed as an abstract contract for adapters to inherit. It includes helper functions for token swaps,
     approval management, and decoding swap paths. The module supports both the Uniswap V3 `exactInput` and
     `exactOutput` functions, as well as the SwapRouter02 interface._

### SwapInputLimitParams

Parameters for a token swap with an exact output amount and a maximum input limit.

_This struct is used to define the parameters for a swap operation where the output token amount is fixed,
     and the input token amount must not exceed the specified maximum._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct SwapInputLimitParams {
  bytes path;
  uint256 deadline;
  uint256 amountInMaximum;
}
```

### SwapOutputLimitParams

Parameters for a token swap with an exact input amount and a minimum output limit.

_This struct is used to define the parameters for a swap operation where the input token amount is fixed,
     and the output token amount must meet or exceed the specified minimum._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |

```solidity
struct SwapOutputLimitParams {
  bytes path;
  uint256 deadline;
  uint256 amountOutMinimum;
}
```

### UNISWAP_ROUTER

```solidity
contract ISwapRouter UNISWAP_ROUTER
```

The address of the Uniswap V3 Router contract.

_This variable holds the address of the Uniswap V3 Router used for token swaps.
     It is immutable and set during the deployment of the `SwapModule` for gas efficiency and safety._

### USE_SWAP_ROUTER_02

```solidity
bool USE_SWAP_ROUTER_02
```

Boolean indicating whether to use the Uniswap V3 SwapRouter02 interface.

_This variable determines whether the `SwapModule` uses the SwapRouter02 interface for token swaps.
     It is immutable and set during the deployment of the `SwapModule` for gas efficiency and safety._

### InvalidSlippageBps

```solidity
error InvalidSlippageBps(uint256 slippageBps)
```

This error is triggered when the slippage BPS value exceeds the acceptable range
        or is otherwise deemed invalid for the swap operation.

_Reverts if an invalid slippage basis points (BPS) value is provided._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| slippageBps | uint256 | The provided slippage BPS value. |

### ZeroAmountIn

```solidity
error ZeroAmountIn()
```

This error is triggered when a swap operation is attempted with an input amount of zero,
        which is invalid and would result in no tokens being swapped.

_Reverts if the input token amount is zero._

### ZeroAmountOut

```solidity
error ZeroAmountOut()
```

This error is triggered when a swap operation is attempted, but the resulting output token amount is zero,
        which is invalid and indicates that the swap did not produce any tokens.

_Reverts if the output token amount is zero._

### EmptySwapPath

```solidity
error EmptySwapPath()
```

This error is triggered when a swap operation is attempted without specifying a valid token swap path,
        which is required for the Uniswap V3 router to execute the swap.

_Reverts if the swap path provided is empty._

### ZeroAmountInMaximum

```solidity
error ZeroAmountInMaximum()
```

This error is triggered when a swap operation is attempted with a maximum input amount of zero,
        which is invalid and would prevent the swap from being executed.

_Reverts if the maximum input token amount (`amountInMaximum`) is zero._

### ZeroAmountOutMinimum

```solidity
error ZeroAmountOutMinimum()
```

This error is triggered when a swap operation is attempted with a minimum output amount of zero,
        which is invalid and would prevent the swap from being executed successfully.

_Reverts if the minimum output token amount (`amountOutMinimum`) is zero._

### InvalidSwapDeadline

```solidity
error InvalidSwapDeadline()
```

This error is triggered when a swap operation is attempted with a deadline that is either zero
        or has already passed, making the swap invalid.

_Reverts if the swap deadline is invalid._

### constructor

```solidity
constructor(address _uniswapRouter, bool useSwapRouter02) internal
```

Initializes the SwapModule with the Uniswap V3 Router address and configuration.

_This constructor sets the Uniswap Router address and determines whether to use the SwapRouter02 interface.
     It ensures that the provided `_uniswapRouter` address is valid and non-zero.

Requirements:
- `_uniswapRouter` must not be a zero address.

Reverts:
- {InvalidZeroAddress} if `_uniswapRouter` is a zero address._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _uniswapRouter | address | The address of the Uniswap V3 Router contract. |
| useSwapRouter02 | bool | Boolean flag indicating whether to use Uniswap V3 SwapRouter02. |

### _swapFlashloanToBorrowToken

```solidity
function _swapFlashloanToBorrowToken(struct ISwapRouter.ExactOutputParams params) internal returns (uint256 amountIn)
```

Swaps tokens obtained from a flash loan into the borrow token required for repayment.

_This function performs the following steps:
     1. Validates the swap parameters, including `amountOut`, `path`, `amountInMaximum`, and `deadline`.
     2. Decodes the output token from the swap path and approves it for the Uniswap router.
     3. Executes the swap using either the Uniswap V3 `exactOutput` function or the SwapRouter02 interface,
        depending on the `USE_SWAP_ROUTER_02` flag.
     4. Clears the token approval after the swap is completed.

Requirements:
- `params.amountOut` must be greater than zero.
- `params.path` must not be empty.
- `params.amountInMaximum` must be greater than zero.
- `params.deadline` must be greater than the current block timestamp.

Reverts:
- {ZeroAmountOut} if `params.amountOut` is zero.
- {EmptySwapPath} if `params.path` is empty.
- {ZeroAmountInMaximum} if `params.amountInMaximum` is zero.
- {InvalidSwapDeadline} if `params.deadline` is zero or has already passed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | struct ISwapRouter.ExactOutputParams | Struct containing the following swap parameters for exact output:        - `path`: The encoded swap path specifying the token swap sequence.        - `recipient`: The address that will receive the output tokens.        - `amountOut`: The exact amount of output tokens to be received.        - `amountInMaximum`: The maximum amount of input tokens that can be spent.        - `deadline`: The timestamp by which the swap must be completed. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| amountIn | uint256 | The amount of input tokens spent during the swap. |

### _swapCollateralToCompoundToken

```solidity
function _swapCollateralToCompoundToken(struct ISwapRouter.ExactInputParams params) internal returns (uint256 amountOut)
```

Swaps collateral tokens into Compound-supported tokens.

_This function performs the following steps:
     1. Validates the swap parameters, including `amountIn`, `path`, `amountOutMinimum`, and `deadline`.
     2. Decodes the input token from the swap path and approves it for the Uniswap router.
     3. Executes the swap using either the Uniswap V3 `exactInput` function or the SwapRouter02 interface,
        depending on the `USE_SWAP_ROUTER_02` flag.
     4. Clears the token approval after the swap is completed.

Requirements:
- `params.amountIn` must be greater than zero.
- `params.path` must not be empty.
- `params.amountOutMinimum` must be greater than zero.
- `params.deadline` must be greater than the current block timestamp.

Reverts:
- {ZeroAmountIn} if `params.amountIn` is zero.
- {EmptySwapPath} if `params.path` is empty.
- {ZeroAmountOutMinimum} if `params.amountOutMinimum` is zero.
- {InvalidSwapDeadline} if `params.deadline` is zero or has already passed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | struct ISwapRouter.ExactInputParams | Struct containing the following swap parameters for exact input:        - `path`: The encoded swap path specifying the token swap sequence.        - `recipient`: The address that will receive the output tokens.        - `amountIn`: The exact amount of input tokens to be spent.        - `amountOutMinimum`: The minimum amount of output tokens to be received.        - `deadline`: The timestamp by which the swap must be completed. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| amountOut | uint256 | The amount of output tokens received during the swap. |

### _approveTokenForSwap

```solidity
function _approveTokenForSwap(contract IERC20 token) internal
```

Approves the Uniswap router to spend an infinite amount of a specified token.

_This function sets the maximum allowance for the Uniswap router to spend the specified token.
     It is used to ensure that the router can execute swaps without running into allowance issues.

Requirements:
- The `token` must be a valid ERC20 token._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| token | contract IERC20 | The token to approve for spending. |

### _clearApprove

```solidity
function _clearApprove(contract IERC20 token) internal
```

Clears the approval of a token for the Uniswap router.

_This function sets the allowance of the specified token for the Uniswap router to zero.
     It is used to revoke the router's permission to spend the token after a swap operation is completed,
     ensuring better security and minimizing unnecessary token approvals._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| token | contract IERC20 | The token to clear approval for. |

### _decodeTokenIn

```solidity
function _decodeTokenIn(bytes path) internal pure returns (contract IERC20 tokenIn)
```

Decodes the input token address from the swap path.

_This function extracts the first 20 bytes of the provided swap path to determine the input token address.
     It uses inline assembly for efficient decoding.

Requirements:
- The `path` must be a valid encoded swap path with a minimum length of 20 bytes._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| path | bytes | The encoded swap path specifying the token swap sequence. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| tokenIn | contract IERC20 | The address of the input token. |

### _decodeTokenOut

```solidity
function _decodeTokenOut(bytes path) internal pure returns (contract IERC20 tokenOut)
```

Decodes the output token address from the swap path.

_This function extracts the last 20 bytes of the provided swap path to determine the output token address.
     It uses inline assembly for efficient decoding.

Requirements:
- The `path` must be a valid encoded swap path with a minimum length of 20 bytes._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| path | bytes | The encoded swap path specifying the token swap sequence. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| tokenOut | contract IERC20 | The address of the output token. |

