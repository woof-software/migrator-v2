// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockMorpho {
    type Id is bytes32;

    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct Position {
        uint256 supplyShares;
        uint128 borrowShares;
        uint128 collateral;
    }

    struct Market {
        uint128 totalSupplyAssets;
        uint128 totalSupplyShares;
        uint128 totalBorrowAssets;
        uint128 totalBorrowShares;
        uint128 lastUpdate;
        uint128 fee;
    }

    mapping(Id => Market) public market;
    mapping(Id => mapping(address => Position)) public position;
    mapping(Id => MarketParams) public idToMarketParams;
    mapping(address => uint256) public nonce;

    /// @notice Sets market parameters for a given market ID
    function setMarketParams(MarketParams memory marketParams) external {
        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        idToMarketParams[id] = marketParams;
    }

    function getMarketId(MarketParams memory marketParams) external pure returns (Id) {
        return Id.wrap(keccak256(abi.encode(marketParams)));
    }

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes calldata
    ) external {
        require(onBehalf != address(0), "Invalid address");
        require(assets > 0, "Invalid assets");

        // Transfer collateral token from the user to this contract
        IERC20(marketParams.collateralToken).transferFrom(msg.sender, address(this), assets);

        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        position[id][onBehalf].collateral += uint128(assets);
    }

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external {
        require(receiver != address(0), "Invalid receiver");
        require(
            position[Id.wrap(keccak256(abi.encode(marketParams)))][onBehalf].collateral >= assets,
            "Insufficient collateral"
        );

        IERC20(marketParams.collateralToken).transfer(receiver, assets);

        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        position[id][onBehalf].collateral -= uint128(assets);
    }

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256) {
        require(receiver != address(0), "Invalid receiver");
        require(assets > 0, "Invalid assets");

        // Transfer borrowed assets to the receiver
        IERC20(marketParams.loanToken).transfer(receiver, assets);

        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        market[id].totalBorrowAssets += uint128(assets);
        position[id][onBehalf].borrowShares += uint128(assets);
        return (assets, assets);
    }

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata
    ) external returns (uint256, uint256) {
        // require(assets > 0, "Invalid assets");
        uint256 amount = assets == 0 ? shares : assets;
        // Transfer repayment assets from the user to this contract
        IERC20(marketParams.loanToken).transferFrom(msg.sender, address(this), amount);

        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        require(position[id][onBehalf].borrowShares >= amount, "Insufficient borrow");

        position[id][onBehalf].borrowShares -= uint128(amount);
        market[id].totalBorrowAssets -= uint128(amount);
        return (assets, shares);
    }

    function accrueInterest(MarketParams memory marketParams) external {
        Id id = Id.wrap(keccak256(abi.encode(marketParams)));
        market[id].lastUpdate = uint128(block.timestamp);
    }
}
