// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockDaiUsds
 * @notice A mock implementation of a Dai to USDS converter contract for testing migrations.
 * @dev This contract assumes a 1:1 conversion rate between DAI and USDS with no fees.
 */
contract MockDaiUsds {
    address public dai;
    address public usds;

    bool public testingNegativeScenario;

    /**
     * @param _dai The address of the DAI token
     * @param _usds The address of the USDS token
     */
    constructor(address _dai, address _usds) {
        require(_dai != address(0), "Invalid DAI address");
        require(_usds != address(0), "Invalid USDS address");
        dai = _dai;
        usds = _usds;
    }

    function setTestingNegativeScenario(bool _testingNegativeScenario) external {
        testingNegativeScenario = _testingNegativeScenario;
    }

    /**
     * @notice Convert DAI to USDS and send to `usr`.
     * @param usr The address that will receive the converted USDS
     * @param wad The amount of DAI to convert (in wei)
     */
    function daiToUsds(address usr, uint256 wad) external {
        // Transfer DAI from caller
        require(IERC20(dai).transferFrom(msg.sender, address(this), wad), "DAI transfer failed");

        // For simplicity, assume 1:1 conversion
        // Transfer USDS to user
        require(IERC20(usds).transfer(usr, (testingNegativeScenario ? (wad / 2) : wad)), "USDS transfer failed");
    }

    /**
     * @notice Convert USDS to DAI and send to `usr`.
     * @param usr The address that will receive the converted DAI
     * @param wad The amount of USDS to convert (in wei)
     */
    function usdsToDai(address usr, uint256 wad) external {
        // Transfer USDS from caller
        require(IERC20(usds).transferFrom(msg.sender, address(this), wad), "USDS transfer failed");

        // For simplicity, assume 1:1 conversion
        // Transfer DAI to user
        require(IERC20(dai).transfer(usr, (testingNegativeScenario ? (wad / 2) : wad)), "DAI transfer failed");
    }
}
