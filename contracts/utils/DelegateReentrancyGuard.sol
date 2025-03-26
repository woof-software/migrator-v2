// SPDX-License-Identifier: BUSL-1.1
// Custom implementation based on OpenZeppelin's ReentrancyGuard.sol (v5.1.0)

pragma solidity 0.8.28;

/**
 * @title DelegateReentrancyGuard
 * @dev A custom implementation based on OpenZeppelin's ReentrancyGuard.sol (v5.1.0).
 *      This version is optimized for `delegatecall`, ensuring reentrancy protection
 *      without modifying the storage layout of the main contract.
 *
 *      Unlike the standard `ReentrancyGuard`, this contract:
 *        - Uses a dedicated **storage slot** to support reentrancy protection with `delegatecall`
 *        - Implements **minimal functionality** required for reentrancy protection
 *        - Does not alter the **storage layout** of the main contract, making it safe for inheritance
 *
 * @notice Use the `nonReentrant` modifier to prevent reentrant calls within a single execution context.
 */
abstract contract DelegateReentrancyGuard {
    /// -------- Constants -------- ///

    /// @dev Status indicating the contract is not in a reentrant state
    uint256 private constant NOT_ENTERED = 1;

    /// @dev Status indicating the contract is currently executing a `nonReentrant` function
    uint256 private constant ENTERED = 2;

    /**
     * @dev Storage structure for the reentrancy guard state.
     * @custom:storage-location erc7201:openzeppelin.storage.ReentrancyGuard
     */
    struct ReentrancyGuardStorage {
        uint256 _status;
    }

    /// @dev Dedicated storage slot for reentrancy status to ensure correct behavior with `delegatecall`.
    ///      Computed as: keccak256("openzeppelin.storage.ReentrancyGuard") - 1 & ~0xff
    bytes32 private constant ReentrancyGuardStorageLocation =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    /// -------- Internal Functions -------- ///

    /**
     * @notice Retrieves the reentrancy guard storage structure.
     * @dev Uses inline assembly to access a dedicated storage slot.
     */
    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := ReentrancyGuardStorageLocation
        }
    }

    /// -------- Errors -------- ///

    /**
     * @dev Thrown when a reentrant call is attempted.
     */
    error ReentrancyGuardReentrantCall();

    /// -------- Modifiers -------- ///

    /**
     * @notice Prevents a contract function from being called reentrantly.
     * @dev Use this modifier for functions that must not be executed more than once in a single execution context.
     *
     * **Limitations:**
     * - Functions marked as `nonReentrant` **cannot call other `nonReentrant` functions** (directly or recursively).
     * - To work around this, declare the `nonReentrant` function as **external** and delegate execution to
     *   an **internal function** that does not use `nonReentrant`.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /// -------- Reentrancy Protection Logic -------- ///

    /**
     * @dev Executes before entering a `nonReentrant` function.
     *      Reverts if the function is already executing within the same transaction context.
     */
    function _nonReentrantBefore() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();

        if ($._status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Mark as entered to prevent reentrant calls
        $._status = ENTERED;
    }

    /**
     * @dev Executes after completing a `nonReentrant` function.
     *      Restores the contract state, allowing subsequent calls in future transactions.
     */
    function _nonReentrantAfter() private {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        $._status = NOT_ENTERED;
    }

    /// -------- View Functions -------- ///

    /**
     * @notice Checks whether a `nonReentrant` function is currently executing.
     * @return `true` if a `nonReentrant` function is in progress within the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        return $._status == ENTERED;
    }
}