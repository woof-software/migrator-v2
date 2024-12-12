# Solidity API

## BaseAdapter

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

### DAI_USDS_CONVERTER

```solidity
contract IDaiUsds DAI_USDS_CONVERTER
```

Converter contract for DAI to USDS.

### DAI

```solidity
address DAI
```

Address of the DAI token.

### USDS

```solidity
address USDS
```

Address of the USDS token.

### ConversionFailed

```solidity
error ConversionFailed(uint256 expectedAmount, uint256 actualAmount)
```

_Reverts if the DAI to USDS conversion fails._

### InsufficientAmountForWrapping

```solidity
error InsufficientAmountForWrapping()
```

### WrappingFailed

```solidity
error WrappingFailed(uint256 expectedAmount, uint256 actualAmount)
```

### UnwrappingFailed

```solidity
error UnwrappingFailed(uint256 expectedAmount, uint256 actualAmount)
```

### constructor

```solidity
constructor(address _uniswapRouter, address _daiUsdsConverter, address _dai, address _usds, address _wrappedNativeToken) internal
```

Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _uniswapRouter | address |  |
| _daiUsdsConverter | address | Address of the DaiUsds converter contract. |
| _dai | address | Address of the DAI token. |
| _usds | address | Address of the USDS token. |
| _wrappedNativeToken | address | Address of the wrapped native token (e.g., WETH). |

### _convertDaiToUsds

```solidity
function _convertDaiToUsds(uint256 daiAmount) internal returns (uint256 usdsAmount)
```

Converts DAI to USDS using the DaiUsds converter contract.

_Reverts with {ConversionFailed} if the amount of USDS received is not equal to the expected amount._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| daiAmount | uint256 | Amount of DAI to be converted. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| usdsAmount | uint256 | Amount of USDS received after conversion. |

### _convertUsdsToDai

```solidity
function _convertUsdsToDai(uint256 usdsAmount) internal returns (uint256 daiAmount)
```

Converts USDS to DAI using the DaiUsds converter contract.

_Reverts with {ConversionFailed} if the amount of DAI received is not equal to the expected amount._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| usdsAmount | uint256 | Amount of USDS to be converted. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| daiAmount | uint256 | Amount of DAI received after conversion. |

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

