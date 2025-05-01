// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SharesMathLib} from "../../libs/morpho/SharesMathLib.sol";
import {MathLib} from "../../libs/morpho/MathLib.sol";
import {NegativeTesting} from "../NegativeTesting.sol";

contract MockMorpho is NegativeTesting {
    using SharesMathLib for uint256;
    using SharesMathLib for uint128;
    using MathLib for uint256;
    using MathLib for uint128;

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
    mapping(Id => MarketParams) public idToMarketParams;
    mapping(Id => mapping(address => Position)) private _position;

    function position(Id id, address user) external view returns (Position memory) {
        Position memory pos = _position[id][user];
        if (negativeTest == NegativeTest.DebtNotCleared) {
            pos.borrowShares = 1;
        }
        return pos;
    }

    function setMarketParams(MarketParams memory marketParams) external {
        Id id = getMarketId(marketParams);
        market[id].lastUpdate = uint128(block.timestamp);
        idToMarketParams[id] = marketParams;
    }

    function getMarketId(MarketParams memory marketParams) public pure returns (Id) {
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

        Id id = getMarketId(marketParams);
        IERC20(marketParams.collateralToken).transferFrom(msg.sender, address(this), assets);

        _position[id][onBehalf].collateral += uint128(assets);
        market[id].totalSupplyAssets += uint128(assets);
    }

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external {
        require(receiver != address(0), "Invalid receiver");

        Id id = getMarketId(marketParams);
        require(_position[id][onBehalf].collateral >= assets, "Insufficient collateral");

        _position[id][onBehalf].collateral -= uint128(assets);
        market[id].totalSupplyAssets -= uint128(assets);

        IERC20(marketParams.collateralToken).transfer(receiver, assets);
    }

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256) {
        require(receiver != address(0), "Invalid receiver");
        require(assets > 0, "Invalid borrow");

        Id id = getMarketId(marketParams);
        Market storage m = market[id];

        uint256 shares = assets.toSharesUp(m.totalBorrowAssets, m.totalBorrowShares);

        m.totalBorrowAssets += uint128(assets);
        m.totalBorrowShares += uint128(shares);
        _position[id][onBehalf].borrowShares += uint128(shares);

        IERC20(marketParams.loanToken).transfer(receiver, assets);
        return (assets, shares);
    }

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata
    ) external returns (uint256, uint256) {
        Id id = getMarketId(marketParams);
        Market storage m = market[id];

        uint256 repayAssets;
        uint256 repayShares;

        if (assets > 0) {
            repayShares = assets.toSharesUp(m.totalBorrowAssets, m.totalBorrowShares);
            repayAssets = assets;
        } else {
            repayAssets = shares.toAssetsUp(m.totalBorrowAssets, m.totalBorrowShares);
            repayShares = shares;
        }

        require(_position[id][onBehalf].borrowShares >= repayShares, "Insufficient borrow");

        _position[id][onBehalf].borrowShares -= uint128(repayShares);
        m.totalBorrowShares -= uint128(repayShares);
        m.totalBorrowAssets -= uint128(repayAssets);

        IERC20(marketParams.loanToken).transferFrom(msg.sender, address(this), repayAssets);

        return (repayAssets, repayShares);
    }

    function accrueInterest(MarketParams memory marketParams) external {
        Id id = getMarketId(marketParams);
        market[id].lastUpdate = uint128(block.timestamp);
        // No interest logic for simplicity — mock only
    }
}
