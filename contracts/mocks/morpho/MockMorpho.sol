// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

contract MockMorpho {
    mapping(Id => MarketParams) public idToMarketParams;
    mapping(Id => Market) public market;
    mapping(Id => mapping(address => Position)) public position;

    /// @notice Sets market parameters for a given market ID
    function setMarketParams(Id marketId, MarketParams memory params) external {
        idToMarketParams[marketId] = params;
    }

    /// @notice Sets market details for a given market ID
    function setMarket(Id marketId, Market memory m) external {
        market[marketId] = m;
    }

    /// @notice Sets a user's position for a specific market
    function setPosition(Id marketId, address user, Position memory p) external {
        position[marketId][user] = p;
    }

    /// @notice Supplies collateral into Morpho
    /// @dev The user must approve this contract to spend their collateral token before calling this function
    function supplyCollateral(Id marketId, uint256 assets, address onBehalf) external {
        require(assets > 0, "Invalid supply amount");

        MarketParams memory marketParams = idToMarketParams[marketId];

        // Transfer collateral token from the user to this contract
        IERC20(marketParams.collateralToken).transferFrom(msg.sender, address(this), assets);

        // Update the user's position with the new collateral
        Position storage userPosition = position[marketId][onBehalf];
        userPosition.collateral += uint128(assets);
    }

    /// @notice Withdraws collateral from Morpho
    function withdrawCollateral(Id marketId, uint256 assets, address onBehalf, address receiver) external {
        Position storage userPosition = position[marketId][onBehalf];

        require(userPosition.collateral >= assets, "Insufficient collateral");

        // Deduct collateral from the user's position
        userPosition.collateral -= uint128(assets);

        // Transfer the collateral token back to the receiver
        MarketParams memory marketParams = idToMarketParams[marketId];
        IERC20(marketParams.collateralToken).transfer(receiver, assets);
    }

    /// @notice Borrows assets from Morpho
    /// @dev The user must have enough collateral to borrow
    function borrow(
        Id marketId,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed) {
        require(assets > 0, "Invalid borrow amount");

        Market storage m = market[marketId];
        Position storage userPosition = position[marketId][onBehalf];

        // Increase market borrow balances
        m.totalBorrowAssets += uint128(assets);
        m.totalBorrowShares += uint128(shares);
        userPosition.borrowShares += uint128(shares);

        MarketParams memory marketParams = idToMarketParams[marketId];

        // Transfer borrowed assets to the receiver
        IERC20(marketParams.loanToken).transfer(receiver, assets);

        return (assets, shares);
    }

    /// @notice Repays borrowed assets in Morpho
    /// @dev The user must approve this contract to spend their loan token before calling this function
    function repay(
        Id marketId,
        uint256 assets,
        uint256 shares,
        address onBehalf
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid) {
        Position storage userPosition = position[marketId][onBehalf];

        require(userPosition.borrowShares >= shares, "Insufficient debt shares");

        MarketParams memory marketParams = idToMarketParams[marketId];

        // Transfer repayment assets from the user to this contract
        IERC20(marketParams.loanToken).transferFrom(msg.sender, address(this), assets);

        // Reduce the borrow shares in the user's position
        userPosition.borrowShares -= uint128(shares);
        market[marketId].totalBorrowShares -= uint128(shares);

        return (assets, shares);
    }
}
