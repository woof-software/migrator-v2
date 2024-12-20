import {
    ethers,
    expect,
    parseEther,
    Zero,
    MaxUint256,
    impersonateAccount,
    stopImpersonatingAccount,
    setBalance,
    parseUnits,
    time
} from "../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    AaveV3Adapter,
    IAavePoolDataProvider__factory,
    IAavePool__factory,
    ERC20__factory,
    IComet__factory
} from "../../typechain-types";

describe("MigratorV2 with AaveV3", function () {
    it("Should migrate positions from AaveV3 to cUSDCv3", async function () {
        const [owner, user] = await ethers.getSigners();
        // token addresses
        const wbtcTokenAddress = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
        const aWbtcTokenAddress = "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8";
        const usdcTokenAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
        const daiTokenAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        const aDaiTokenAddress = "0x018008bfb33d285247A21d44E50697654f754e63";
        const usdtTokenAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
        const varDebtUsdtTokenAddress = "0x6df1C1E379bC5a00a7b4C6e67A203333772f45A8";
        const varDebtUsdcTokenAddress = "0x72E95b8931767C79bA4EeE721354d6E99a61D004";
        const usdsTokenAddress = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
        const weth9TokenAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        // aaave v3 addresses
        const aaveV3DataProviderAddress = "0x41393e5e337606dc3821075Af65AeE84D7688CBD";
        const aaveV3PoolAddress = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
        // convertor Dai to Usds address
        const daiUsdsAddress = "0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A";
        // uniswap router address
        const uniswapRouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        // comet addresses (cUSDCv3)
        const cUSDCv3Address = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
        // const cUSDCv3ExtAddress = "0x285617313887d43256F852cAE0Ee4de4b68D45B0";

        const wbtcToken = ERC20__factory.connect(wbtcTokenAddress, user);
        const userBalanceBefore = await wbtcToken.balanceOf(user.address);

        // simulation of the vault contract work
        await setBalance(wbtcTokenAddress, parseEther("1000"));
        await impersonateAccount(wbtcTokenAddress);
        const signerWbtcTokenAddress = await ethers.getSigner(wbtcTokenAddress);

        console.log("User wbtcToken balance before: ", userBalanceBefore.toString());

        await wbtcToken.connect(signerWbtcTokenAddress).transfer(user.address, parseUnits("0.5", 8));

        const userBalanceAfter = await wbtcToken.balanceOf(user.address);

        console.log("User wbtcToken balance after: ", userBalanceAfter.toString());

        await stopImpersonatingAccount(daiTokenAddress);

        const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);

        const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

        expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

        const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

        await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.1", 8));

        await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.1", 8), user.address, 0);

        const dataProviderAfter1 = await aaveV3DataProvider.getUserReserveData(usdtTokenAddress, user.address);
        console.log("currentVariableDebt: ", dataProviderAfter1.currentVariableDebt);

        await aaveV3Pool.borrow(usdcTokenAddress, parseUnits("100", 6), 2, 0, user.address);

        const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(usdtTokenAddress, user.address);
        console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", owner);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy(
            uniswapRouterAddress,
            daiUsdsAddress,
            daiTokenAddress,
            usdsTokenAddress,
            weth9TokenAddress,
            aaveV3Pool.address,
            aaveV3DataProvider.address
        )) as AaveV3Adapter;
        await aaveV3Adapter.deployed();

        const adapters = [aaveV3Adapter.address];
        const comets = [cUSDCv3Address]; // Compound USDC (cUSDCv3) market

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6", // Uniswap V3 pool USDC / USDT
                baseToken: usdcTokenAddress, // USDC
                isToken0: true
            }
        ];

        const MigratorV2Factory = await ethers.getContractFactory("MigratorV2");
        const migrator = (await MigratorV2Factory.connect(owner).deploy(
            owner.address,
            adapters,
            comets,
            flashData
        )) as MigratorV2;
        await migrator.deployed();

        expect(migrator.address).to.be.properAddress;

        // Approve migration
        const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
        const varDebtUsdcToken = ERC20__factory.connect(varDebtUsdcTokenAddress, user);
        const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

        await aWbtcToken.approve(migrator.address, parseUnits("0.1", 8));

        await cUSDCv3Contract.allow(migrator.address, true);
        expect(await cUSDCv3Contract.isAllowed(user.address, migrator.address)).to.be.true;

        const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
        const varDebtUsdcBalance = await varDebtUsdcToken.balanceOf(user.address);
        console.log("aWbtcUserBalance:", aWbtcUserBalance);
        console.log("varDebtUsdcBalance:", varDebtUsdcBalance);

        const position = {
            borrows: [
                {
                    aDebtToken: varDebtUsdcTokenAddress,
                    amount: MaxUint256
                }
            ],
            collateral: [{ aToken: aWbtcToken.address, amount: MaxUint256 }],
            swaps: [
                {
                    pathOfSwapFlashloan: [],
                    amountInMaximum: 0,
                    pathSwapCollateral: [],
                    amountOutMinimum: 0
                }
            ]
        };

        const encodedData = ethers.utils.defaultAbiCoder.encode(
            [
                "tuple(tuple(address aDebtToken, uint256 amount)[] borrows, tuple(address aToken, uint256 amount)[] collateral, tuple(bytes pathOfSwapFlashloan, uint256 amountInMaximum, bytes pathSwapCollateral, uint256 amountOutMinimum)[] swaps)"
            ],
            [position]
        );

        const flashAmount = parseUnits("105", 6);

        const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
            user.address,
            wbtcTokenAddress
        );
        expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

        await expect(
            migrator.connect(user).migrate(aaveV3Adapter.address, comets[0], encodedData, flashAmount)
        ).to.emit(migrator, "MigrationExecuted");

        const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
        const varDebtUsdcBalanceAfterMigrate = await varDebtUsdcToken.balanceOf(user.address);

        console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
        console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdcBalanceAfterMigrate);

        expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
        expect(varDebtUsdcBalanceAfterMigrate).to.be.equal(Zero);

        const collateralWbtcBalanceAfterMigrate = await cUSDCv3Contract.collateralBalanceOf(
            user.address,
            wbtcTokenAddress
        );
        console.log("collateralWbtcBalanceAfterMigrate:", collateralWbtcBalanceAfterMigrate);

        expect(collateralWbtcBalanceAfterMigrate).to.be.above(Zero);
    }).timeout(0);
});
