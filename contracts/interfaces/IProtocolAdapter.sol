// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IProtocolAdapter {
    /**
     * @notice Executes the migration of positions for a specific protocol.
     * @param user The address of the user whose positions are being migrated.
     * @param migrationData Encoded data specific to the protocol's migration logic.
     */
    function executeMigration(address user, bytes calldata migrationData) external;
}