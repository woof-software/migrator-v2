# Solidity API

## WrapModule

### NATIVE_TOKEN

```solidity
address NATIVE_TOKEN
```

--------Constants-------- ///

### WRAPPED_NATIVE_TOKEN

```solidity
contract IWETH9 WRAPPED_NATIVE_TOKEN
```

Address of the wrapped native token (e.g., WETH).

### WrappingFailed

```solidity
error WrappingFailed(uint256 expectedAmount, uint256 actualAmount)
```

--------Errors-------- ///

### UnwrappingFailed

```solidity
error UnwrappingFailed(uint256 expectedAmount, uint256 actualAmount)
```

### constructor

```solidity
constructor(address _wrappedNativeToken) internal
```

Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _wrappedNativeToken | address | Address of the wrapped native token (e.g., WETH). |

### _wrapNativeToken

```solidity
function _wrapNativeToken(uint256 nativeAmount) internal returns (uint256 wrappedAmount)
```

Wraps the native token into its ERC-20 equivalent (e.g., ETH to WETH).

_Reverts with {WrapUnwrapFailed} if the wrap operation fails._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| nativeAmount | uint256 | Amount of the native token to wrap. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| wrappedAmount | uint256 | Amount of the wrapped token received. |

### _unwrapNativeToken

```solidity
function _unwrapNativeToken(uint256 wrappedAmount) internal returns (uint256 nativeAmount)
```

Unwraps the wrapped token into the native token (e.g., WETH to ETH).

_Reverts with {WrapUnwrapFailed} if the unwrap operation fails._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| wrappedAmount | uint256 | Amount of the wrapped token to unwrap. |

