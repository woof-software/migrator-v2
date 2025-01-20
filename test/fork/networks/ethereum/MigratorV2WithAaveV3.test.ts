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
    loadFixture
} from "../../../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    AaveV3DaiUsdsAdapter,
    IAavePoolDataProvider__factory,
    IAavePool__factory,
    ERC20__factory,
    IComet__factory,
    MockSwapRouter__factory
} from "../../../../typechain-types";

describe("MigratorV2 with AaveV3", function () {
    async function setupEnv() {
        const [owner, user] = await ethers.getSigners();

        const treasuryAddress = "0x000000000000000000000000000000000000dEaD";
        // token addresses
        const wbtcTokenAddress = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
        const aWbtcTokenAddress = "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8";
        const usdcTokenAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
        const daiTokenAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        const aDaiTokenAddress = "0x018008bfb33d285247A21d44E50697654f754e63";
        const varDebtDaiTokenAddress = "0xcF8d0c70c850859266f5C338b38F9D663181C314";
        const usdtTokenAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
        const aUsdtTokenAddress = "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a";
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
        const UniswapV3PoolUsdcUsdt = "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6";
        // comet addresses (cUSDCv3)
        const cUSDCv3Address = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
        // const cUSDCv3ExtAddress = "0x285617313887d43256F852cAE0Ee4de4b68D45B0";

        const wbtcToken = ERC20__factory.connect(wbtcTokenAddress, user);
        const usdtToken = ERC20__factory.connect(usdtTokenAddress, user);
        const usdcToken = ERC20__factory.connect(usdcTokenAddress, user);
        const daiToken = ERC20__factory.connect(daiTokenAddress, user);
        const usdsToken = ERC20__factory.connect(usdsTokenAddress, user);

        // simulation of the vault contract work
        await setBalance(treasuryAddress, parseEther("1000"));
        await impersonateAccount(treasuryAddress);
        const treasurySigner = await ethers.getSigner(treasuryAddress);

        await wbtcToken.connect(treasurySigner).transfer(user.address, parseUnits("0.01", 8));
        await usdtToken.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));
        await usdcToken.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));

        await stopImpersonatingAccount(treasuryAddress);

        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3DaiUsdsAdapter", owner);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapRouterAddress,
            daiUsdsConverter: daiUsdsAddress,
            dai: daiTokenAddress,
            usds: usdsTokenAddress,
            wrappedNativeToken: weth9TokenAddress,
            aaveLendingPool: aaveV3PoolAddress,
            aaveDataProvider: aaveV3DataProviderAddress,
            isFullMigration: true
        })) as AaveV3DaiUsdsAdapter;
        await aaveV3Adapter.deployed();

        const adapters = [aaveV3Adapter.address];
        const comets = [cUSDCv3Address]; // Compound USDC (cUSDCv3) market

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: UniswapV3PoolUsdcUsdt, // Uniswap V3 pool USDC / USDT
                baseToken: usdcTokenAddress, // USDC
                isToken0: true
            }
        ];

        const MigratorV2Factory = await ethers.getContractFactory("MigratorV2");
        const migratorV2 = (await MigratorV2Factory.connect(owner).deploy(
            owner.address,
            adapters,
            comets,
            flashData
        )) as MigratorV2;
        await migratorV2.deployed();

        expect(migratorV2.address).to.be.properAddress;

        return {
            owner,
            user,
            wbtcTokenAddress,
            aWbtcTokenAddress,
            usdcTokenAddress,
            daiTokenAddress,
            aDaiTokenAddress,
            varDebtDaiTokenAddress,
            usdtTokenAddress,
            aUsdtTokenAddress,
            varDebtUsdtTokenAddress,
            varDebtUsdcTokenAddress,
            usdsTokenAddress,
            weth9TokenAddress,
            aaveV3DataProviderAddress,
            aaveV3PoolAddress,
            daiUsdsAddress,
            uniswapRouterAddress,
            cUSDCv3Address,
            wbtcToken,
            usdtToken,
            usdcToken,
            daiToken,
            usdsToken,
            aaveV3Adapter,
            migratorV2
        };
    }
    context("Migrate positions from AaveV3 to cUSDCv3", function () {
        it.skip("Should be successful migration: without swaps", async function () {
            const {
                user,
                wbtcToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                varDebtUsdcTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(usdcTokenAddress, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(usdtTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtUsdcTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdcBalance = await varDebtUsdcToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtUsdcBalance:", varDebtUsdcBalance);

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtUsdcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("110", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            await expect(
                migratorV2.connect(user).migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount)
            ).to.emit(migratorV2, "MigrationExecuted");

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

            // expect(collateralWbtcBalanceAfterMigrate).to.be.above(Zero);
        }).timeout(0);

        it.skip("Should be successful migration: with single flashloan swap", async function () {
            const {
                user,
                wbtcToken,
                daiToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                varDebtDaiTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(daiTokenAddress, parseUnits("100", 18), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtDaiTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtDiaBalance = await varDebtDaiToken.balanceOf(user.address);
            const daiBalance = await daiToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtDaiBalance:", varDebtDiaBalance);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtDaiTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(daiTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountInMaximum: parseUnits("110", 6)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("110", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            let collateralBalance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("wbtc collateral balance before migration:", collateralBalance);

            await expect(
                migratorV2.connect(user).migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount)
            ).to.emit(migratorV2, "MigrationExecuted");

            const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdtBalanceAfterMigrate = await varDebtDaiToken.balanceOf(user.address);

            console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
            console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdtBalanceAfterMigrate);

            expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
            expect(varDebtUsdtBalanceAfterMigrate).to.be.equal(Zero);

            collateralBalance = await cUSDCv3Contract.collateralBalanceOf(user.address, wbtcTokenAddress);
            console.log("wbtc collateral balance after migration:", collateralBalance);
        }).timeout(0);

        it.skip("Should be successful migration: with single flashloan swap and several borrows", async function () {
            const {
                user,
                wbtcToken,
                daiToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                varDebtDaiTokenAddress,
                varDebtUsdcTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(daiTokenAddress, parseUnits("70", 18), 2, 0, user.address);
            await aaveV3Pool.borrow(usdcTokenAddress, parseUnits("45", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtDaiTokenAddress, user);
            const varDebtUsdcToken = ERC20__factory.connect(varDebtUsdcTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtDiaBalance = await varDebtDaiToken.balanceOf(user.address);
            const varDebtUsdcBalance = await varDebtUsdcToken.balanceOf(user.address);
            const daiBalance = await daiToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtDaiBalance:", varDebtDiaBalance);
            console.log("varDebtUsdcBalance:", varDebtUsdcBalance);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtDaiTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(daiTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountInMaximum: parseUnits("80", 6)
                        }
                    },
                    {
                        aDebtToken: varDebtUsdcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("130", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            let collateralBalance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("wbtc collateral balance before migration:", collateralBalance);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount, { gasLimit: 10000000 })
            ).to.emit(migratorV2, "MigrationExecuted");

            const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdtBalanceAfterMigrate = await varDebtDaiToken.balanceOf(user.address);

            console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
            console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdtBalanceAfterMigrate);

            expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
            expect(varDebtUsdtBalanceAfterMigrate).to.be.equal(Zero);

            collateralBalance = await cUSDCv3Contract.collateralBalanceOf(user.address, wbtcTokenAddress);
            console.log("wbtc collateral balance after migration:", collateralBalance);
        }).timeout(0);

        it("Should be successful migration: with single flashloan and collateral swaps", async function () {
            const {
                user,
                wbtcToken,
                daiToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                varDebtDaiTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(daiTokenAddress, parseUnits("100", 18), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtDaiTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtDiaBalance = await varDebtDaiToken.balanceOf(user.address);
            const daiBalance = await daiToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtDaiBalance:", varDebtDiaBalance);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtDaiTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(daiTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountInMaximum: parseUnits("110", 6)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(wbtcTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("110", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            let cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance before migration:", cUSDCv3Balance);

            await expect(
                migratorV2.connect(user).migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount)
            ).to.emit(migratorV2, "MigrationExecuted");

            const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdtBalanceAfterMigrate = await varDebtDaiToken.balanceOf(user.address);

            console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
            console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdtBalanceAfterMigrate);

            expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
            expect(varDebtUsdtBalanceAfterMigrate).to.be.equal(Zero);

            cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance after migration:", cUSDCv3Balance);
        }).timeout(0);

        it.skip("Should be successful migration: with single collateral swap", async function () {
            const {
                user,
                wbtcToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                varDebtUsdcTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(usdcTokenAddress, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(usdtTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtUsdcTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdcBalance = await varDebtUsdcToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtUsdcBalance:", varDebtUsdcBalance);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtUsdcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(wbtcTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("105", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            let cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance before migration:", cUSDCv3Balance);

            await expect(
                migratorV2.connect(user).migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount)
            ).to.emit(migratorV2, "MigrationExecuted");

            const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdcBalanceAfterMigrate = await varDebtUsdcToken.balanceOf(user.address);

            console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
            console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdcBalanceAfterMigrate);

            expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
            expect(varDebtUsdcBalanceAfterMigrate).to.be.equal(Zero);

            cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance after migration:", cUSDCv3Balance);
        }).timeout(0);

        it.skip("Should be successful migration: with single collaterals swaps", async function () {
            const {
                user,
                wbtcToken,
                usdtToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                usdtTokenAddress,
                usdcTokenAddress,
                daiTokenAddress,
                wbtcTokenAddress,
                aWbtcTokenAddress,
                aUsdtTokenAddress,
                varDebtUsdcTokenAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(daiTokenAddress, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await usdtToken.approve(aaveV3Pool.address, parseUnits("100", 6));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);
            await aaveV3Pool.supply(usdtToken.address, parseUnits("100", 6), user.address, 0);

            await aaveV3Pool.borrow(usdcTokenAddress, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(usdtTokenAddress, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aWbtcTokenAddress, user);
            const aUsdtToken = ERC20__factory.connect(aUsdtTokenAddress, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));
            await aUsdtToken.approve(migratorV2.address, parseUnits("200", 6));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtUsdcTokenAddress, user);
            const cUSDCv3Contract = IComet__factory.connect(cUSDCv3Address, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const aWbtcUserBalance = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdcBalance = await varDebtUsdcToken.balanceOf(user.address);
            console.log("aWbtcUserBalance:", aWbtcUserBalance);
            console.log("varDebtUsdcBalance:", varDebtUsdcBalance);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: varDebtUsdcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aWbtcTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(wbtcTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aUsdtTokenAddress,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(usdtTokenAddress, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(usdcTokenAddress, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            const positionAbi = [
                "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
                "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
            ];

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + positionAbi.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("105", 6);

            const collateralWbtcBalanceBeforeMigrate = await cUSDCv3Contract.collateralBalanceOf(
                user.address,
                wbtcTokenAddress
            );
            expect(collateralWbtcBalanceBeforeMigrate).to.be.equal(Zero);

            let cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance before migration:", cUSDCv3Balance);

            await expect(
                migratorV2.connect(user).migrate(aaveV3Adapter.address, cUSDCv3Address, migrationData, flashAmount)
            ).to.emit(migratorV2, "MigrationExecuted");

            const aWbtcUserBalanceAfterMigrate = await aWbtcToken.balanceOf(user.address);
            const varDebtUsdcBalanceAfterMigrate = await varDebtUsdcToken.balanceOf(user.address);

            console.log("aWbtcUserBalanceAfterMigrate:", aWbtcUserBalanceAfterMigrate);
            console.log("varDebtUsdcBalanceAfterMigrate:", varDebtUsdcBalanceAfterMigrate);

            expect(aWbtcUserBalanceAfterMigrate).to.be.equal(Zero);
            expect(varDebtUsdcBalanceAfterMigrate).to.be.equal(Zero);

            cUSDCv3Balance = await cUSDCv3Contract.balanceOf(user.address);
            console.log("cUSDCv3Balance after migration:", cUSDCv3Balance);
        }).timeout(0);
    });

    context("---- DEV TESTING ----", function () {
        it.skip("-DEV: test Path for Single Swaps: USDT->USDC", async function () {
            const { user, usdcTokenAddress, usdtTokenAddress, uniswapRouterAddress, usdtToken, usdcToken } =
                await loadFixture(setupEnv);

            const amountOutMinimum = parseUnits("45", 6);
            const amountIn = parseUnits("50", 6);

            await usdcToken.approve(uniswapRouterAddress, MaxUint256);
            // await usdtToken.approve(uniswapRouterAddress, MaxUint256);

            const balanceUsdcBefore = await usdcToken.balanceOf(user.address);
            console.log("balanceUsdcBefore:", balanceUsdcBefore.toString());

            const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

            const balanceUsdtBefore = await usdtToken.balanceOf(user.address);
            console.log("balanceUsdtBefore:", balanceUsdtBefore.toString());

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const tx = await swapRouter.exactInput({
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(usdcTokenAddress, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(usdtTokenAddress, 20)
                ]),
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000 + 1800),
                amountIn,
                amountOutMinimum
            });

            await tx.wait(1);

            const balanceUsdtAfter = await usdtToken.balanceOf(user.address);
            console.log("balanceUsdtAfter:", balanceUsdtAfter.toString());

            expect(balanceUsdtAfter).to.be.above(balanceUsdtBefore);
        }).timeout(0);

        it.skip("-DEV: test Path for Single Swaps: USDT->USDC", async function () {
            const { user, usdcTokenAddress, usdtTokenAddress, uniswapRouterAddress, usdtToken, usdcToken } =
                await loadFixture(setupEnv);

            const amountInMaximum = parseUnits("55", 6);
            const amountOut = parseUnits("50", 6);

            await usdtToken.approve(uniswapRouterAddress, amountInMaximum);

            const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

            const balanceUsdtBefore = await usdtToken.balanceOf(user.address);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const tx = await swapRouter.exactOutput({
                // path: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8dac17f958d2ee523a2206206994597c13d831ec7",
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(usdcTokenAddress, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(usdtTokenAddress, 20)
                ]),
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000 + 1800),
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            });

            await tx.wait(1);

            const balanceUsdtAfter = await usdtToken.balanceOf(user.address);

            expect(balanceUsdtAfter).to.be.below(balanceUsdtBefore);
            await expect(tx).to.be.changeTokenBalance(usdcToken, user, amountOut);
        }).timeout(0);

        it.skip("-DEV: test Path for Multihop Swaps: USDT->DAI->USDS", async function () {
            const {
                user,
                daiTokenAddress,
                usdsTokenAddress,
                usdtTokenAddress,
                uniswapRouterAddress,
                usdtToken,
                daiToken,
                usdsToken
            } = await loadFixture(setupEnv);
            const amountInMaximum = parseUnits("55", 6);
            const amountOut = parseUnits("50", 18);

            await usdtToken.approve(uniswapRouterAddress, amountInMaximum);

            const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

            const balanceUsdtBefore = await usdtToken.balanceOf(user.address);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const tx = await swapRouter.exactOutput({
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(usdsTokenAddress, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(daiTokenAddress, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(usdtTokenAddress, 20)
                ]),
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000 + 1800),
                amountOut: amountOut,
                amountInMaximum: amountInMaximum
            });

            await tx.wait(1);

            const balanceUsdtAfter = await usdtToken.balanceOf(user.address);

            await expect(tx).to.be.changeTokenBalance(usdsToken, user, amountOut);
            expect(balanceUsdtAfter).to.be.below(balanceUsdtBefore);
        }).timeout(0);
    });
});
