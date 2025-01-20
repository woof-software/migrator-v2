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
    AaveV3DaiAdapter,
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
        const tokensAddresses = {
            WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
            USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
            DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
            WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
        };

        // aaave v3 addresses
        const aTokensAddresses = {
            aWBTC: "0x078f358208685046a11C85e8ad32895DED33A249",
            aDAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
            aUSDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620"
        };

        const varDebtTokensAddresses = {
            varDebtDAI: "0x8619d80FB0141ba7F184CbF22fd724116D9f7ffC",
            varDebtUSDT: "0xfb00AC187a8Eb5AFAE4eACE434F493Eb62672df7",
            varDebtUSDC: "0xf611aEb5013fD2c0511c9CD55c7dc5C1140741A6"
        };

        const aaveV3DataProviderAddress = "0x7F23D86Ee20D869112572136221e173428DD740B";
        const aaveV3PoolAddress = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";

        // uniswap router address
        const uniswapRouterAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        const UniswapV3PoolUsdcUsdt = "0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6";
        // comet addresses (cUSDCv3)
        const cUSDCv3Address = "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf";

        const wbtcToken = ERC20__factory.connect(tokensAddresses.WBTC, user);
        const usdtToken = ERC20__factory.connect(tokensAddresses.USDT, user);
        const usdcToken = ERC20__factory.connect(tokensAddresses.USDC, user);
        const daiToken = ERC20__factory.connect(tokensAddresses.DAI, user);
        // const usdsToken = ERC20__factory.connect(tokensAddresses.USDS, user);

        // simulation of the vault contract work
        await setBalance(treasuryAddress, parseEther("1000"));
        await impersonateAccount(treasuryAddress);
        const treasurySigner = await ethers.getSigner(treasuryAddress);

        await wbtcToken.connect(treasurySigner).transfer(user.address, parseUnits("0.01", 8));
        await usdtToken.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));
        await usdcToken.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));

        await stopImpersonatingAccount(treasuryAddress);

        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", owner);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapRouterAddress,
            // daiUsdsConverter: daiUsdsAddress,
            // dai: tokensAddresses.DAI,
            // usds: tokensAddresses.USDS,
            wrappedNativeToken: tokensAddresses.WETH,
            aaveLendingPool: aaveV3PoolAddress,
            aaveDataProvider: aaveV3DataProviderAddress,
            isFullMigration: true
        })) as AaveV3DaiAdapter;
        await aaveV3Adapter.deployed();

        const adapters = [aaveV3Adapter.address];
        const comets = [cUSDCv3Address]; // Compound USDC (cUSDCv3) market

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: UniswapV3PoolUsdcUsdt, // Uniswap V3 pool USDC / USDT
                baseToken: tokensAddresses.USDC, // USDC
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
            treasuryAddress,
            tokensAddresses,
            aTokensAddresses,
            varDebtTokensAddresses,
            aaveV3DataProviderAddress,
            aaveV3PoolAddress,
            // daiUsdsAddress,
            uniswapRouterAddress,
            cUSDCv3Address,
            wbtcToken,
            usdtToken,
            usdcToken,
            daiToken,
            // usdsToken,
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
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.USDC, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.USDT, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtUSDC, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtUSDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
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
                tokensAddresses.WBTC
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
                tokensAddresses.WBTC
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
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.DAI, parseUnits("100", 18), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtDAI, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtDAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("110", 6)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
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
                tokensAddresses.WETH
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

            collateralBalance = await cUSDCv3Contract.collateralBalanceOf(user.address, tokensAddresses.WBTC);
            console.log("wbtc collateral balance after migration:", collateralBalance);
        }).timeout(0);

        it.skip("Should be successful migration: with single flashloan swap and several borrows", async function () {
            const {
                user,
                wbtcToken,
                daiToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.DAI, parseUnits("70", 18), 2, 0, user.address);
            await aaveV3Pool.borrow(tokensAddresses.USDC, parseUnits("45", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtDAI, user);
            const varDebtUsdcToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtUSDC, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtDAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("80", 6)
                        }
                    },
                    {
                        aDebtToken: varDebtTokensAddresses.varDebtUSDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
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
                tokensAddresses.WBTC
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

            collateralBalance = await cUSDCv3Contract.collateralBalanceOf(user.address, tokensAddresses.WBTC);
            console.log("wbtc collateral balance after migration:", collateralBalance);
        }).timeout(0);

        it("Should be successful migration: with single flashloan and collateral swaps", async function () {
            const {
                user,
                wbtcToken,
                daiToken,
                aaveV3DataProviderAddress,
                aaveV3PoolAddress,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.DAI, parseUnits("100", 18), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtDaiToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtDAI, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtDAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("110", 6)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.WBTC, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
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
                tokensAddresses.WBTC
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
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses,
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.USDC, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.USDT, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtUSDC, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtUSDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.WBTC, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
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
                tokensAddresses.WETH
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
                cUSDCv3Address,
                aaveV3Adapter,
                migratorV2,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3DataProvider = IAavePoolDataProvider__factory.connect(aaveV3DataProviderAddress, user);
            const dataProviderBefore = await aaveV3DataProvider.getUserReserveData(tokensAddresses.DAI, user.address);

            expect(dataProviderBefore.currentATokenBalance).to.be.equal(Zero);

            const aaveV3Pool = IAavePool__factory.connect(aaveV3PoolAddress, user);

            await wbtcToken.approve(aaveV3Pool.address, parseUnits("0.01", 8));
            await usdtToken.approve(aaveV3Pool.address, parseUnits("100", 6));
            await aaveV3Pool.supply(wbtcToken.address, parseUnits("0.01", 8), user.address, 0);
            await aaveV3Pool.supply(usdtToken.address, parseUnits("100", 6), user.address, 0);

            await aaveV3Pool.borrow(tokensAddresses.USDC, parseUnits("100", 6), 2, 0, user.address);

            const dataProviderAfter = await aaveV3DataProvider.getUserReserveData(tokensAddresses.USDT, user.address);
            console.log("currentVariableDebt: ", dataProviderAfter.currentVariableDebt);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aTokensAddresses.aWBTC, user);
            const aUsdtToken = ERC20__factory.connect(aTokensAddresses.aUSDT, user);
            await aWbtcToken.approve(migratorV2.address, parseUnits("0.01", 8));
            await aUsdtToken.approve(migratorV2.address, parseUnits("200", 6));

            const varDebtUsdcToken = ERC20__factory.connect(varDebtTokensAddresses.varDebtUSDC, user);
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
                        aDebtToken: varDebtTokensAddresses.varDebtUSDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aTokensAddresses.aWBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.WETH, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aTokensAddresses.aUSDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokensAddresses.USDT, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokensAddresses.USDC, 20)
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
                tokensAddresses.WETH
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
            const {
                user,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses,
                uniswapRouterAddress,
                usdtToken,
                usdcToken
            } = await loadFixture(setupEnv);

            const amountOutMinimum = parseUnits("45", 6);
            const amountIn = parseUnits("50", 6);

            await usdcToken.approve(uniswapRouterAddress, MaxUint256);

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
                    ethers.utils.hexZeroPad(tokensAddresses.USDC, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(tokensAddresses.USDT, 20)
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
            const {
                user,
                tokensAddresses,
                aTokensAddresses,
                varDebtTokensAddresses,
                uniswapRouterAddress,
                usdtToken,
                usdcToken
            } = await loadFixture(setupEnv);

            const amountInMaximum = parseUnits("55", 6);
            const amountOut = parseUnits("50", 6);

            await usdtToken.approve(uniswapRouterAddress, amountInMaximum);

            const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

            const balanceUsdtBefore = await usdtToken.balanceOf(user.address);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const tx = await swapRouter.exactOutput({
                path: ethers.utils.concat([
                    ethers.utils.hexZeroPad(tokensAddresses.USDC, 20),
                    fee3000,
                    ethers.utils.hexZeroPad(tokensAddresses.USDT, 20)
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
    });
});
