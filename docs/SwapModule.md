# Solidity API

## SwapModule

Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.

_Designed as an abstract contract for adapters to inherit._

### Swap

--------Structs-------- ///

```solidity
struct Swap {
  bytes pathOfSwapFlashloan;
  uint256 amountInMaximum;
  bytes pathSwapCollateral;
  uint256 amountOutMinimum;
}
```

### MAX_BPS

```solidity
uint256 MAX_BPS
```

Maximum allowable basis points (BPS) for slippage calculations.

_1 BPS = 0.01%, so 10,000 BPS represents 100%._

### UNISWAP_ROUTER

```solidity
contract ISwapRouter UNISWAP_ROUTER
```

The address of the Uniswap V3 Router contract.

_This is immutable and set during contract deployment._

### InvalidZeroAddress

```solidity
error InvalidZeroAddress()
```

_Reverts if an address provided is zero._

### SwapFailed

```solidity
error SwapFailed()
```

_Reverts if a swap operation fails._

### InvalidSlippageBps

```solidity
error InvalidSlippageBps(uint256 slippageBps)
```

_Reverts if an invalid slippage basis points value is provided._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| slippageBps | uint256 | The provided slippage BPS value. |

### ZeroAmountIn

```solidity
error ZeroAmountIn()
```

_Reverts if the input token amount is zero._

### ZeroAmountOut

```solidity
error ZeroAmountOut()
```

_Reverts if the output token amount is zero._

### EmptySwapPath

```solidity
error EmptySwapPath()
```

_Reverts if the swap path provided is empty._

### constructor

```solidity
constructor(address _uniswapRouter) internal
```

Initializes the SwapModule with the Uniswap V3 Router address.

_Reverts with {InvalidZeroAddress} if the provided address is zero._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _uniswapRouter | address | The address of the Uniswap V3 Router contract. |

### _swapFlashloanToBorrowToken

```solidity
function _swapFlashloanToBorrowToken(struct ISwapRouter.ExactOutputParams params) internal returns (uint256 amountIn)
```

Swaps tokens using Uniswap V3 to obtain borrow tokens for repayment.

_Reverts with {ZeroAmountOut} if the output token amount is zero.
Reverts with {EmptySwapPath} if the swap path provided is empty.
Reverts with {SwapFailed} if the swap operation fails._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | struct ISwapRouter.ExactOutputParams | Struct containing swap parameters for exact output. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| amountIn | uint256 | The amount of input tokens spent. |

### _swapCollateralToCompoundToken

```solidity
function _swapCollateralToCompoundToken(struct ISwapRouter.ExactInputParams params) internal returns (uint256 amountOut)
```

Swaps collaterals into Compound-supported tokens.

_Reverts with {ZeroAmountIn} if the input token amount is zero.
Reverts with {EmptySwapPath} if the swap path provided is empty.
Reverts with {SwapFailed} if the swap operation fails._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| params | struct ISwapRouter.ExactInputParams | Struct containing swap parameters for exact input. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| amountOut | uint256 | The amount of output tokens received. |

### _calculateSlippageAmount

```solidity
function _calculateSlippageAmount(uint256 amount, uint256 slippageBps) internal pure returns (uint256 slippageAmount)
```

Calculates the maximum allowable slippage amount based on a given percentage in BPS (Basis Points).

_Reverts with {InvalidSlippageBps} if the provided `slippageBps` exceeds the maximum allowable BPS (MAX_BPS)._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | The original amount to calculate slippage on. |
| slippageBps | uint256 | The allowed slippage in Basis Points (BPS), where 10,000 BPS equals 100%. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| slippageAmount | uint256 | The allowable amount of tokens for slippage. |

### _approveTokenForSwap

```solidity
function _approveTokenForSwap(contract IERC20NonStandard token, uint256 amount) internal
```

Approves a token for the Uniswap router.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| token | contract IERC20NonStandard | The token to approve. |
| amount | uint256 | The amount of tokens to approve. |

### _decodeTokenIn

```solidity
function _decodeTokenIn(bytes path) internal pure returns (address tokenIn)
```

Decodes the input token address from the swap path.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| path | bytes | The swap path. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| tokenIn | address | Address of the input token. |

### _decodeTokenOut

```solidity
function _decodeTokenOut(bytes path) internal pure returns (address tokenOut)
```

Decodes the output token address from the swap path.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| path | bytes | The swap path. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| tokenOut | address | Address of the output token. |

