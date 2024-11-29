// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.28;

interface IDaiUsds {
    // Events
    event DaiToUsds(address indexed caller, address indexed usr, uint256 wad);
    event UsdsToDai(address indexed caller, address indexed usr, uint256 wad);

    // View Functions
    function dai() external view returns (address);
    function daiJoin() external view returns (address);
    function usds() external view returns (address);
    function usdsJoin() external view returns (address);

    // State-changing Functions
    function daiToUsds(address usr, uint256 wad) external;
    function usdsToDai(address usr, uint256 wad) external;
}
