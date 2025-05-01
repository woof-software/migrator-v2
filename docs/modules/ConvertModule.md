# Solidity API

## ConvertModule

Provides functionality for converting between DAI and USDS using a DaiUsds converter contract.

_This abstract contract is designed to be inherited by other contracts that require stablecoin conversion.
     It ensures efficient and safe conversions by validating inputs and handling errors._

### DAI_USDS_CONVERTER

```solidity
contract IDaiUsds DAI_USDS_CONVERTER
```

The DaiUsds converter contract used for converting between DAI and USDS.

_This contract facilitates the conversion of DAI to USDS and vice versa. It is initialized
     during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety._

### DAI

```solidity
contract IERC20 DAI
```

Address of the DAI token.

_This variable holds the address of the DAI token used for conversions in the `ConvertModule`.
     It is initialized during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety._

### USDS

```solidity
contract IERC20 USDS
```

Address of the USDS token.

_This variable holds the address of the USDS token used for conversions in the `ConvertModule`.
     It is initialized during the deployment of the `ConvertModule` and is immutable for gas efficiency and safety._

### ConversionFailed

```solidity
error ConversionFailed(uint256 expectedAmount, uint256 actualAmount)
```

This error is triggered when the amount of tokens received from the Dai ⇄ USDS conversion
        does not match the expected amount, indicating a failure in the conversion process.

_Reverts if the DAI to USDS or USDS to DAI conversion fails._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| expectedAmount | uint256 | The expected amount of tokens to be received after conversion. |
| actualAmount | uint256 | The actual amount of tokens received after conversion. |

### IdenticalTokenAddresses

```solidity
error IdenticalTokenAddresses(address token)
```

This error is triggered when the DAI and USDS token addresses are the same,
        which is invalid for the Dai ⇄ USDS conversion process.

_Reverts if the provided token addresses are identical._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| token | address | Address of the token that caused the error. |

### ConverterConfigMismatch

```solidity
error ConverterConfigMismatch(address converter, address dai, address usds)
```

This error is triggered when the provided DaiUsds converter, DAI, and USDS addresses
        do not match the expected configuration. This ensures that the converter and token
        addresses are consistent and valid for the conversion process.

_Reverts if the configuration of the DaiUsds converter, DAI token, or USDS token is inconsistent._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| converter | address | The address of the DaiUsds converter contract. |
| dai | address | The address of the DAI token. |
| usds | address | The address of the USDS token. |

### constructor

```solidity
constructor(address _daiUsdsConverter, address _dai, address _usds) internal
```

Initializes the ConvertModule with the DaiUsds converter, DAI token, and USDS token addresses.

_This constructor sets up the DaiUsds converter and token addresses. It validates the provided addresses
     to ensure they are consistent and non-zero when a converter is specified. If no converter is provided
     (`_daiUsdsConverter` is zero), the DAI and USDS addresses are set to zero as well.

Requirements:
- If `_daiUsdsConverter` is non-zero:
  - `_dai` and `_usds` must not be zero addresses.
  - `_dai` and `_usds` must not be identical.

Reverts:
- {ConverterConfigMismatch} if the provided DaiUsds converter, DAI, and USDS addresses are inconsistent.
- {IdenticalTokenAddresses} if `_dai` and `_usds` are the same address._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _daiUsdsConverter | address | The address of the DaiUsds converter contract. |
| _dai | address | The address of the DAI token. |
| _usds | address | The address of the USDS token. |

### _convertDaiToUsds

```solidity
function _convertDaiToUsds(uint256 daiAmount) internal returns (uint256 usdsAmount)
```

Converts DAI to USDS using the DaiUsds converter contract.

_This function performs the following steps:
     1. Approves the DaiUsds converter contract to spend the specified `daiAmount`.
     2. Retrieves the current USDS balance of the contract before the conversion.
     3. Calls the `daiToUsds` function on the DaiUsds converter contract to perform the conversion.
     4. Retrieves the USDS balance of the contract after the conversion.
     5. Calculates the amount of USDS received by subtracting the pre-conversion balance from the post-conversion balance.
     6. Reverts with {ConversionFailed} if the amount of USDS received does not match the expected amount (`daiAmount`).

Requirements:
- The DaiUsds converter contract must be properly configured and operational.
- The contract must have sufficient DAI balance to perform the conversion.

Reverts:
- {ConversionFailed} if the amount of USDS received is not equal to the expected amount._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| daiAmount | uint256 | The amount of DAI to be converted. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| usdsAmount | uint256 | The amount of USDS received after conversion. |

### _convertUsdsToDai

```solidity
function _convertUsdsToDai(uint256 usdsAmount) internal returns (uint256 daiAmount)
```

Converts USDS to DAI using the DaiUsds converter contract.

_This function performs the following steps:
     1. Approves the DaiUsds converter contract to spend the specified `usdsAmount`.
     2. Retrieves the current DAI balance of the contract before the conversion.
     3. Calls the `usdsToDai` function on the DaiUsds converter contract to perform the conversion.
     4. Retrieves the DAI balance of the contract after the conversion.
     5. Calculates the amount of DAI received by subtracting the pre-conversion balance from the post-conversion balance.
     6. Reverts with {ConversionFailed} if the amount of DAI received does not match the expected amount (`usdsAmount`).

Requirements:
- The DaiUsds converter contract must be properly configured and operational.
- The contract must have sufficient USDS balance to perform the conversion.

Reverts:
- {ConversionFailed} if the amount of DAI received is not equal to the expected amount._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| usdsAmount | uint256 | The amount of USDS to be converted. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| daiAmount | uint256 | The amount of DAI received after conversion. |

