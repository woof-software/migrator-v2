// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAaveLendingPool {
    /**
     * @dev Deposits an `amount` of underlying asset into the reserve, receiving in return overlying aTokens.
     * - E.g. User deposits 100 USDC and gets in return 100 aUSDC
     * @param asset The address of the underlying asset to deposit
     * @param amount The amount to be deposited
     * @param onBehalfOf The address that will receive the aTokens, same as msg.sender if the user
     * wants to receive them on his own wallet, or a different address if the beneficiary of aTokens
     * is a different wallet
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     * 0 if the action is executed directly by the user, without any middle-man
     */
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /**
     * @dev Withdraws an `amount` of underlying asset from the reserve, burning the equivalent aTokens owned
     * - E.g. User has 100 aUSDC, calls withdraw() and receives 100 USDC, burning the 100 aUSDC
     * @param asset The address of the underlying asset to withdraw
     * @param amount The underlying amount to be withdrawn
     *      (pass type(uint256).max to withdraw all available aTokens)
     * @param to Address that will receive the underlying, same as msg.sender if the user
     * wants to receive it on his own wallet, or a different address if the beneficiary is a
     * different wallet
     * @return The final amount withdrawn
     */
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);

    /**
     * @dev Allows borrowers to repay their borrowings on a specific reserve, burning the equivalent debt tokens owned.
     * - E.g. User repays 100 USDC and burns the equivalent debt tokens
     * @param asset The address of the borrowed underlying asset previously borrowed
     * @param amount The amount to repay
     * @param rateMode The interest rate mode of the debt: 1 for Stable, 2 for Variable
     * @param onBehalfOf The address of the user who will get his debt reduced/removed. Should be the address
     * of the user calling the function if he wants to reduce/remove his own debt, or the address of any other
     * other borrower whose debt should be removed
     * @return The final amount repaid
     */
    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external returns (uint256);

    /**
     * @dev Allows users to borrow a specific `amount` of the reserve underlying asset, provided that the borrower
     * already deposited enough collateral, or he was given enough allowance by a credit delegator on the
     * corresponding credit delegation token
     * - E.g. User borrows 100 USDC passing, receiving the 100 USDC in his wallet
     * @param asset The address of the underlying asset to borrow
     * @param amount The amount to be borrowed
     * @param interestRateMode The interest rate mode: 1 for Stable, 2 for Variable
     * @param referralCode Code used to register the integrator originating the operation, for potential rewards.
     * 0 if the action is executed directly by the user, without any middle-man
     * @param onBehalfOf Address of the user who will receive the debt. Should be the address of the user
     * calling the function if he wants to borrow on his own wallet, or the address of any other other user
     * wanting to borrow with his own collateral
     */
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
}