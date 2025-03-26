// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

abstract contract CommonErrors {
    /**
     * @dev Reverts if an address provided is zero.
     */
    error InvalidZeroAddress();
}
