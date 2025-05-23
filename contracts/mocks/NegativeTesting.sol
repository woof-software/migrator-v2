// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

abstract contract NegativeTesting {
    enum NegativeTest {
        None,
        Reentrant,
        InvalidCallbackData,
        FakeUniswapV3Pool,
        SwapRouterNotSupported,
        DebtNotCleared,
        InvalidPoll,
        Dust
    }

    NegativeTest public negativeTest = NegativeTest.None;

    function setNegativeTest(NegativeTest _negativeTest) external {
        negativeTest = _negativeTest;
    }
}
