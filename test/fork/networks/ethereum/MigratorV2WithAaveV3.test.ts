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
    AaveV3UsdsAdapter,
    IAavePoolDataProvider__factory,
    IAavePool__factory,
    ERC20__factory,
    IComet__factory,
    MockSwapRouter__factory
} from "../../../../typechain-types";

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const POSITION_ABI = [
    "tuple(address aDebtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

describe("MigratorV2 with AaveV3", function () {
    async function setupEnv() {
        const [owner, user] = await ethers.getSigners();

        const treasuryAddress = "0x000000000000000000000000000000000000dEaD";

        const tokenAddresses = {
            WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            USDS: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
            WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
        };

        const aaveContractAddresses = {
            aToken: {
                WBTC: "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8",
                DAI: "0x018008bfb33d285247A21d44E50697654f754e63",
                USDT: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a"
            },
            variableDebtToken: {
                DAI: "0xcF8d0c70c850859266f5C338b38F9D663181C314",
                USDT: "0x6df1C1E379bC5a00a7b4C6e67A203333772f45A8",
                USDC: "0x72E95b8931767C79bA4EeE721354d6E99a61D004"
            },
            pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            protocolDataProvider: "0x41393e5e337606dc3821075Af65AeE84D7688CBD"
        };

        // convertor Dai to Usds address
        const daiUsdsAddress = "0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A";

        const uniswapContractAddresses = {
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            pools: {
                USDC_USDT: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6"
            }
        };

        const compoundContractAddresses = {
            markets: {
                cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3"
            }
        };

        const tokenContracts = {
            WBTC: ERC20__factory.connect(tokenAddresses.WBTC, user),
            USDC: ERC20__factory.connect(tokenAddresses.USDC, user),
            DAI: ERC20__factory.connect(tokenAddresses.DAI, user),
            USDT: ERC20__factory.connect(tokenAddresses.USDT, user),
            USDS: ERC20__factory.connect(tokenAddresses.USDS, user),
            WETH: ERC20__factory.connect(tokenAddresses.WETH, user)
        };

        const tokenDecimals = {
            WBTC: await tokenContracts.WBTC.decimals(),
            USDC: await tokenContracts.USDC.decimals(),
            DAI: await tokenContracts.DAI.decimals(),
            USDT: await tokenContracts.USDT.decimals(),
            USDS: await tokenContracts.USDS.decimals(),
            WETH: await tokenContracts.WETH.decimals()
        };

        // simulation of the vault contract work
        await setBalance(treasuryAddress, parseEther("1000"));
        await impersonateAccount(treasuryAddress);
        const treasurySigner = await ethers.getSigner(treasuryAddress);

        await tokenContracts.WBTC.connect(treasurySigner).transfer(user.address, parseUnits("0.01", 8));
        await tokenContracts.USDT.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));
        await tokenContracts.USDC.connect(treasurySigner).transfer(user.address, parseUnits("100", 6));

        await stopImpersonatingAccount(treasuryAddress);

        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3UsdsAdapter", owner);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            daiUsdsConverter: daiUsdsAddress,
            dai: tokenAddresses.DAI,
            usds: tokenAddresses.USDS,
            wrappedNativeToken: tokenAddresses.WETH,
            aaveLendingPool: aaveContractAddresses.pool,
            aaveDataProvider: aaveContractAddresses.protocolDataProvider,
            isFullMigration: true
        })) as AaveV3UsdsAdapter;
        await aaveV3Adapter.deployed();

        const adapters = [aaveV3Adapter.address];
        const comets = [compoundContractAddresses.markets.cUSDCv3]; // Compound USDC (cUSDCv3) market

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: uniswapContractAddresses.pools.USDC_USDT, // Uniswap V3 pool USDC / USDT
                baseToken: tokenAddresses.USDC, // USDC
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
            tokenAddresses,
            tokenContracts,
            tokenDecimals,
            aaveContractAddresses,
            uniswapContractAddresses,
            compoundContractAddresses,
            daiUsdsAddress,
            aaveV3Adapter,
            migratorV2
        };
    }

    beforeEach(async function () {
        // this.timeout(60000);
        // const sleepTime = 15000; // 15 seconds
        // console.log(`Sleeping for ${sleepTime / 1000} seconds...`);
        // await sleep(sleepTime); // 15 seconds
    });

    context("Migrate positions from AaveV3 to cUSDCv3", function () {
        it("Should be successful migration: without swaps", async function () {
            // @todo one collateral and one borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmount = parseUnits("0.01", tokenDecimals.WBTC);
            const borrowAmount = parseUnits("100", tokenDecimals.USDC);
            const interestRateMode = 2; // variable
            const referralCode = 0;

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmount);
            await aaveV3Pool.supply(tokenAddresses.WBTC, supplyAmount, user.address, referralCode);

            await aaveV3Pool.borrow(tokenAddresses.USDC, borrowAmount, interestRateMode, referralCode, user.address);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmount);

            const varDebtUsdcToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.USDC, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("110", tokenDecimals.USDC);

            expect(userBalancesBefore.collateralComet).to.be.equal(Zero);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesAfter:", userBalancesAfter);

            expect(userBalancesAfter.collateralAave).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave).to.be.equal(Zero);

            expect(userBalancesAfter.collateralComet).to.be.equal(userBalancesBefore.collateralAave);

            expect(await cUSDCv3Contract.balanceOf(user.address)).to.be.equal(Zero);
        }).timeout(0);

        it("Should be successful migration: with single flashloan swap", async function () {
            // @todo one collateral and one borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmount = parseUnits("0.01", tokenDecimals.WBTC);
            const borrowAmount = parseUnits("100", tokenDecimals.DAI);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmount);
            await aaveV3Pool.supply(tokenAddresses.WBTC, supplyAmount, user.address, referralCode);

            await aaveV3Pool.borrow(tokenAddresses.DAI, borrowAmount, interestRateMode, referralCode, user.address);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmount);

            const varDebtDaiToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.DAI, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtDaiToken.balanceOf(user.address),
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("130", tokenDecimals.USDC);

            expect(userBalancesBefore.collateralComet).to.be.equal(Zero);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtDaiToken.balanceOf(user.address),
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesAfter:", userBalancesAfter);

            expect(userBalancesAfter.collateralAave).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave).to.be.equal(Zero);

            expect(userBalancesAfter.collateralComet).to.be.equal(userBalancesBefore.collateralAave);

            expect(await cUSDCv3Contract.balanceOf(user.address)).to.be.equal(Zero);
        }).timeout(0);

        it("Should be successful migration: with single flashloan swap and several borrows", async function () {
            // @todo one collateral and two borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmount = parseUnits("0.01", tokenDecimals.WBTC);
            const borrowAmounts = {
                DAI: parseUnits("70", tokenDecimals.DAI),
                USDC: parseUnits("45", tokenDecimals.USDC)
            };

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmount);
            await aaveV3Pool.supply(tokenAddresses.WBTC, supplyAmount, user.address, 0);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            await aaveV3Pool.borrow(
                tokenAddresses.DAI,
                borrowAmounts.DAI,
                interestRateMode,
                referralCode,
                user.address
            );
            await aaveV3Pool.borrow(
                tokenAddresses.USDC,
                borrowAmounts.USDC,
                interestRateMode,
                referralCode,
                user.address
            );

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmount);

            const varDebtDaiToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.DAI, user);
            const varDebtUsdcToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.USDC, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowsAave: {
                    DAI: await varDebtDaiToken.balanceOf(user.address),
                    USDC: await varDebtUsdcToken.balanceOf(user.address)
                },
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("80", 6)
                        }
                    },
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("130", tokenDecimals.USDC);

            expect(userBalancesBefore.collateralComet).to.be.equal(Zero);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowsAave: {
                    DAI: await varDebtDaiToken.balanceOf(user.address),
                    USDC: await varDebtUsdcToken.balanceOf(user.address)
                },
                collateralComet: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
            };

            console.log("userBalancesAfter:", userBalancesAfter);

            expect(userBalancesAfter.collateralAave).to.be.equal(Zero);
            expect(userBalancesAfter.borrowsAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowsAave.USDC).to.be.equal(Zero);

            expect(userBalancesAfter.collateralComet).to.be.equal(userBalancesBefore.collateralAave);

            expect(await cUSDCv3Contract.balanceOf(user.address)).to.be.equal(Zero);
        }).timeout(0);

        it("Should be successful migration: with single flashloan and collateral swaps", async function () {
            // @todo one collateral and one borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmount = parseUnits("0.01", tokenDecimals.WBTC);
            const borrowAmount = parseUnits("100", tokenDecimals.DAI);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmount);
            await aaveV3Pool.supply(tokenAddresses.WBTC, supplyAmount, user.address, referralCode);

            await aaveV3Pool.borrow(tokenAddresses.DAI, borrowAmount, interestRateMode, referralCode, user.address);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmount);

            const varDebtDaiToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.DAI, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtDaiToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", 6)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("130", tokenDecimals.USDC);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtDaiToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesAfter:", userBalancesAfter);

            expect(userBalancesAfter.collateralAave).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave).to.be.equal(Zero);

            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Should be successful migration: with single collateral swap", async function () {
            // @todo one collateral and one borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmount = parseUnits("0.01", tokenDecimals.WBTC);
            const borrowAmount = parseUnits("100", tokenDecimals.USDC);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmount);
            await aaveV3Pool.supply(tokenAddresses.WBTC, supplyAmount, user.address, referralCode);

            await aaveV3Pool.borrow(tokenAddresses.USDC, borrowAmount, interestRateMode, referralCode, user.address);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmount);

            const varDebtUsdcToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.USDC, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesBefore:", userBalancesBefore);
            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("105", tokenDecimals.USDC);

            expect(userBalancesBefore.collateralsComet.USDC).to.be.equal(Zero);
            expect(userBalancesBefore.collateralsComet.WBTC).to.be.equal(Zero);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralAave: await aWbtcToken.balanceOf(user.address),
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesAfter:", userBalancesAfter);

            expect(userBalancesAfter.collateralAave).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave).to.be.equal(Zero);

            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Should be successful migration: with single collaterals swaps", async function () {
            // @todo two collateral and one borrow tokens
            const {
                user,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const supplyAmounts = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC),
                USDT: parseUnits("100", tokenDecimals.USDT)
            };

            const borrowAmount = parseUnits("100", tokenDecimals.USDC);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            await tokenContracts.WBTC.approve(aaveV3Pool.address, supplyAmounts.WBTC);
            await aaveV3Pool.supply(tokenAddresses.WBTC, MaxUint256, user.address, referralCode);

            await tokenContracts.USDT.approve(aaveV3Pool.address, supplyAmounts.USDT);
            await aaveV3Pool.supply(tokenAddresses.USDT, MaxUint256, user.address, referralCode);

            await aaveV3Pool.borrow(tokenAddresses.USDC, borrowAmount, interestRateMode, referralCode, user.address);

            // Approve migration
            const aWbtcToken = ERC20__factory.connect(aaveContractAddresses.aToken.WBTC, user);
            await aWbtcToken.approve(migratorV2.address, supplyAmounts.WBTC);

            const aUsdtToken = ERC20__factory.connect(aaveContractAddresses.aToken.USDT, user);
            await aUsdtToken.approve(migratorV2.address, supplyAmounts.USDT);

            const varDebtUsdcToken = ERC20__factory.connect(aaveContractAddresses.variableDebtToken.USDC, user);
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WBTC: await aWbtcToken.balanceOf(user.address),
                    USDT: await aUsdtToken.balanceOf(user.address)
                },
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("110", tokenDecimals.USDC);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            ).to.emit(migratorV2, "MigrationExecuted");

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aWbtcToken.balanceOf(user.address),
                    USDT: await aUsdtToken.balanceOf(user.address)
                },
                borrowAave: await varDebtUsdcToken.balanceOf(user.address),
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            console.log("userBalancesAfter:", userBalancesBefore);

            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave).to.be.equal(Zero);

            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
        }).timeout(0);
    });

    // context("---- DEV TESTING ----", function () {
    //     it.skip("-DEV: test Path for Single Swaps: USDT->USDC", async function () {
    //         const { user, usdcTokenAddress, usdtTokenAddress, uniswapRouterAddress, usdtToken, usdcToken } =
    //             await loadFixture(setupEnv);

    //         const amountOutMinimum = parseUnits("45", 6);
    //         const amountIn = parseUnits("50", 6);

    //         await usdcToken.approve(uniswapRouterAddress, MaxUint256);
    //         // await usdtToken.approve(uniswapRouterAddress, MaxUint256);

    //         const balanceUsdcBefore = await usdcToken.balanceOf(user.address);
    //         console.log("balanceUsdcBefore:", balanceUsdcBefore.toString());

    //         const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

    //         const balanceUsdtBefore = await usdtToken.balanceOf(user.address);
    //         console.log("balanceUsdtBefore:", balanceUsdtBefore.toString());

    //         const FEE_3000 = 3000; // 0.3%
    //         // Convert fee to 3-byte hex
    //         const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

    //         const tx = await swapRouter.exactInput({
    //             path: ethers.utils.concat([
    //                 ethers.utils.hexZeroPad(usdcTokenAddress, 20),
    //                 fee3000,
    //                 ethers.utils.hexZeroPad(usdtTokenAddress, 20)
    //             ]),
    //             recipient: user.address,
    //             deadline: Math.floor(Date.now() / 1000 + 1800),
    //             amountIn,
    //             amountOutMinimum
    //         });

    //         await tx.wait(1);

    //         const balanceUsdtAfter = await usdtToken.balanceOf(user.address);
    //         console.log("balanceUsdtAfter:", balanceUsdtAfter.toString());

    //         expect(balanceUsdtAfter).to.be.above(balanceUsdtBefore);
    //     }).timeout(0);

    //     it.skip("-DEV: test Path for Single Swaps: USDT->USDC", async function () {
    //         const { user, usdcTokenAddress, usdtTokenAddress, uniswapRouterAddress, usdtToken, usdcToken } =
    //             await loadFixture(setupEnv);

    //         const amountInMaximum = parseUnits("55", 6);
    //         const amountOut = parseUnits("50", 6);

    //         await usdtToken.approve(uniswapRouterAddress, amountInMaximum);

    //         const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

    //         const balanceUsdtBefore = await usdtToken.balanceOf(user.address);

    //         const FEE_3000 = 3000; // 0.3%
    //         // Convert fee to 3-byte hex
    //         const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

    //         const tx = await swapRouter.exactOutput({
    //             // path: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8dac17f958d2ee523a2206206994597c13d831ec7",
    //             path: ethers.utils.concat([
    //                 ethers.utils.hexZeroPad(usdcTokenAddress, 20),
    //                 fee3000,
    //                 ethers.utils.hexZeroPad(usdtTokenAddress, 20)
    //             ]),
    //             recipient: user.address,
    //             deadline: Math.floor(Date.now() / 1000 + 1800),
    //             amountOut: amountOut,
    //             amountInMaximum: amountInMaximum
    //         });

    //         await tx.wait(1);

    //         const balanceUsdtAfter = await usdtToken.balanceOf(user.address);

    //         expect(balanceUsdtAfter).to.be.below(balanceUsdtBefore);
    //         await expect(tx).to.be.changeTokenBalance(usdcToken, user, amountOut);
    //     }).timeout(0);

    //     it.skip("-DEV: test Path for Multihop Swaps: USDT->DAI->USDS", async function () {
    //         const {
    //             user,
    //             daiTokenAddress,
    //             usdsTokenAddress,
    //             usdtTokenAddress,
    //             uniswapRouterAddress,
    //             usdtToken,
    //             daiToken,
    //             usdsToken
    //         } = await loadFixture(setupEnv);
    //         const amountInMaximum = parseUnits("55", 6);
    //         const amountOut = parseUnits("50", 18);

    //         await usdtToken.approve(uniswapRouterAddress, amountInMaximum);

    //         const swapRouter = MockSwapRouter__factory.connect(uniswapRouterAddress, user);

    //         const balanceUsdtBefore = await usdtToken.balanceOf(user.address);

    //         const FEE_3000 = 3000; // 0.3%
    //         // Convert fee to 3-byte hex
    //         const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

    //         const tx = await swapRouter.exactOutput({
    //             path: ethers.utils.concat([
    //                 ethers.utils.hexZeroPad(usdsTokenAddress, 20),
    //                 fee3000,
    //                 ethers.utils.hexZeroPad(daiTokenAddress, 20),
    //                 fee3000,
    //                 ethers.utils.hexZeroPad(usdtTokenAddress, 20)
    //             ]),
    //             recipient: user.address,
    //             deadline: Math.floor(Date.now() / 1000 + 1800),
    //             amountOut: amountOut,
    //             amountInMaximum: amountInMaximum
    //         });

    //         await tx.wait(1);

    //         const balanceUsdtAfter = await usdtToken.balanceOf(user.address);

    //         await expect(tx).to.be.changeTokenBalance(usdsToken, user, amountOut);
    //         expect(balanceUsdtAfter).to.be.below(balanceUsdtBefore);
    //     }).timeout(0);
    // });
});
