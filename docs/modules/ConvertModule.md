# Solidity API

## ConvertModule

Provides advanced swap functionality using Uniswap V3, with slippage checking and error handling.

_Designed as an abstract contract for adapters to inherit._

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

### constructor

```solidity
constructor(address _daiUsdsConverter, address _dai, address _usds) internal
```

Initializes the adapter with the DaiUsds converter, wrapped token, and token addresses.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _daiUsdsConverter | address | Address of the DaiUsds converter contract. |
| _dai | address | Address of the DAI token. |
| _usds | address | Address of the USDS token. |

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

