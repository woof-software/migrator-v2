// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title CommonErrors
 * @notice Defines common error types used across multiple contracts for consistent error handling.
 * @dev This abstract contract provides reusable error definitions to simplify and standardize error management.
 */
abstract contract CommonErrors {
    /**
     * @dev Reverts if an address provided is zero.
     */
    error InvalidZeroAddress();

    /**
     * @dev Reverts if any address matches another.
     */
    error IdenticalAddresses();
}
