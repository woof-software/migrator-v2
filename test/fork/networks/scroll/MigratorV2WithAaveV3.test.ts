import {
    ethers,
    expect,
    parseEther,
    Zero,
    MaxUint256,
    anyValue,
    impersonateAccount,
    stopImpersonatingAccount,
    setBalance,
    parseUnits,
    loadFixture,
    log
} from "../../../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    AaveV3UsdsAdapter,
    IComet__factory,
    IWrappedTokenGatewayV3__factory,
    IAavePool__factory,
    ERC20__factory,
    ERC20,
    IAToken__factory,
    IAToken,
    IDebtToken__factory,
    IDebtToken
} from "../../../../typechain-types";

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const POSITION_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

describe("MigratorV2 and AaveV3Adapter contracts", function () {
    async function setupEnv() {
        // console.log("Chain ID:", ethers.provider.network.chainId);

        const [owner, user] = await ethers.getSigners();

        const tokenAddresses: Record<string, string> = {
            SCR: "0xd29687c813D741E2F938F4aC377128810E217b1b",
            USDC: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4",
            weETH: "0x01f0a31698C4d065659b9bdC21B3610292a1c506",
            WETH: "0x5300000000000000000000000000000000000004",
            wstETH: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32"
        };

        const treasuryAddresses: Record<string, string> = {
            SCR: "0xeE198F4a91E5b05022dc90535729B2545D3b03DF",
            USDC: "0x3Fc69CC4A842838bCDC9499178740226062b14E4",
            weETH: "0xB9Ca61A6D5fA0c443F3c48Ab1fbf0118964308D6",
            WETH: "0x9B36f165baB9ebe611d491180418d8De4b8f3a1f",
            wstETH: "0x613d13b610fc98C7995922D97a5Ee60eB220304c"
        };

        const aaveContractAddresses = {
            aToken: {
                SCR: "0x25718130C2a8eb94e2e1FAFB5f1cDd4b459aCf64",
                USDC: "0x1D738a3436A8C49CefFbaB7fbF04B660fb528CbD",
                weETH: "0xd80A5e16DBDC52Bd1C947CEDfA22c562Be9129C8",
                WETH: "0xf301805bE1Df81102C957f6d4Ce29d2B8c056B2a",
                wstETH: "0x5B1322eeb46240b02e20062b8F0F9908d525B09c"
            },
            variableDebtToken: {
                SCR: "0xFFbA405BBF25B2e6C454d18165F2fd8786858c6B",
                USDC: "0x3d2E209af5BFa79297C88D6b57F89d792F6E28EE",
                weETH: "0x009D88C6a6B4CaA240b71C98BA93732e26F2A55A",
                WETH: "0xfD7344CeB1Df9Cf238EcD667f4A6F99c6Ef44a56",
                wstETH: "0x8a035644322129800C3f747f54Db0F4d3c0A2877"
            },
            pool: "0x11fCfe756c05AD438e312a7fd934381537D3cFfe",
            protocolDataProvider: "0xe2108b60623C6Dcf7bBd535bD15a451fd0811f7b",
            wrappedTokenGateway: "0x31A239f3e39c5D8BA6B201bA81ed584492Ae960F"
        };

        const uniswapContractAddresses = {
            router: "TODO",
            pools: {
                USDC_USDT: "TODO"
            }
        };

        const compoundContractAddresses = {
            markets: {
                cUSDCv3: ""
            }
        };

        const tokenContracts: Record<string, ERC20> = Object.fromEntries(
            Object.entries(tokenAddresses).map(([symbol, address]) => [symbol, ERC20__factory.connect(address, user)])
        );

        const tokenDecimals: Record<string, number> = Object.fromEntries(
            await Promise.all(
                Object.entries(tokenContracts).map(async ([symbol, contract]) => {
                    const decimals = await contract.decimals();
                    return [symbol, decimals];
                })
            )
        );

        const aTokenContracts: Record<string, IAToken> = Object.fromEntries(
            Object.entries(aaveContractAddresses.aToken).map(([symbol, address]) => [
                symbol,
                IAToken__factory.connect(address, user)
            ])
        );

        const debtTokenContracts: Record<string, IDebtToken> = Object.fromEntries(
            Object.entries(aaveContractAddresses.variableDebtToken).map(([symbol, address]) => [
                symbol,
                IDebtToken__factory.connect(address, user)
            ])
        );

        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", owner);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
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
                liquidityPool: uniswapContractAddresses.pools.USDC_USDT, // Uniswap V3 pool USDC / weETH
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
            treasuryAddresses,
            tokenAddresses,
            tokenContracts,
            tokenDecimals,
            aaveContractAddresses,
            aTokenContracts,
            debtTokenContracts,
            uniswapContractAddresses,
            compoundContractAddresses,
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

    context("Migrate positions from AaveV3 to Compound III", function () {
        it.only(
            "Scn.#1: migration of all collaterals | three collateral (incl. Native Token) and three borrow tokens | only swaps (coll. & borrow pos.)",
            async function () {
                const {
                    user,
                    treasuryAddresses,
                    tokenAddresses,
                    tokenContracts,
                    tokenDecimals,
                    aaveContractAddresses,
                    aTokenContracts,
                    debtTokenContracts,
                    compoundContractAddresses,
                    aaveV3Adapter,
                    migratorV2
                } = await loadFixture(setupEnv);

                // simulation of the vault contract work
                const fundingData = {
                    WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                    weETH: parseUnits("300", tokenDecimals.weETH)
                };
                // --- start
                for (const [token, amount] of Object.entries(fundingData)) {
                    const tokenContract = tokenContracts[token];
                    const treasuryAddress = treasuryAddresses[token];

                    await setBalance(treasuryAddress, parseEther("1000"));
                    await impersonateAccount(treasuryAddress);
                    const treasurySigner = await ethers.getSigner(treasuryAddress);

                    await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                    await stopImpersonatingAccount(treasuryAddress);
                }
                // --- end

                // setup the collateral and borrow positions in AaveV3
                const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

                const interestRateMode = 2; // variable
                const referralCode = 0;

                // total supply amount equivalent to 1385 USD
                const supplyAmounts = {
                    ETH: parseEther("0.05"), // 130 USD
                    WBTC: fundingData.WBTC, // 955 USD
                    weETH: fundingData.weETH // 300 USD
                };

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    if (token === "ETH") {
                        // supply ETH as collateral
                        const wrappedTokenGateway = IWrappedTokenGatewayV3__factory.connect(
                            aaveContractAddresses.wrappedTokenGateway,
                            user
                        );
                        await wrappedTokenGateway.depositETH(aaveV3Pool.address, user.address, referralCode, {
                            value: supplyAmounts.ETH
                        });
                    } else {
                        await tokenContracts[token].approve(aaveV3Pool.address, amount);
                        await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
                    }
                }

                // total borrow amount equivalent to 435 USD
                const borrowAmounts = {
                    USDC: parseUnits("100", tokenDecimals.USDC), // ~100 USD
                    SCR: parseUnits("70", tokenDecimals.SCR), // ~70 USD
                    wstETH: parseUnits("15", tokenDecimals.wstETH) // ~265 USD
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    await aaveV3Pool.borrow(
                        tokenAddresses[token],
                        amount,
                        interestRateMode,
                        referralCode,
                        user.address
                    );
                }

                // Approve migration
                for (const [symbol] of Object.entries(supplyAmounts)) {
                    if (symbol === "ETH") {
                        aTokenContracts["WETH"].approve(migratorV2.address, MaxUint256);
                    } else {
                        await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
                    }
                }

                // set allowance for migrator to spend cUSDCv3
                const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

                await cUSDCv3Contract.allow(migratorV2.address, true);
                expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

                const userBalancesBefore = {
                    collateralsAave: {
                        ETH: await aTokenContracts.WETH.balanceOf(user.address),
                        WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                        weETH: await aTokenContracts.weETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                        SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                        wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDC: await cUSDCv3Contract.balanceOf(user.address),
                        WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                        WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                    }
                };

                log("userBalancesBefore:", userBalancesBefore);

                const position = {
                    borrows: [
                        {
                            aDebtToken: aaveContractAddresses.variableDebtToken.USDC,
                            amount: MaxUint256,
                            swapParams: {
                                path: "0x",
                                amountInMaximum: 0
                            }
                        },
                        {
                            aDebtToken: aaveContractAddresses.variableDebtToken.SCR,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                    FEE_3000,
                                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                                ]),
                                amountInMaximum: parseUnits("70", tokenDecimals.USDC)
                                    .mul(SLIPPAGE_BUFFER_PERCENT)
                                    .div(100)
                            }
                        },
                        {
                            aDebtToken: aaveContractAddresses.variableDebtToken.wstETH,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                    FEE_3000,
                                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                                ]),
                                amountInMaximum: parseUnits("265", tokenDecimals.USDC)
                                    .mul(SLIPPAGE_BUFFER_PERCENT)
                                    .div(100)
                            }
                        }
                    ],
                    collaterals: [
                        {
                            aToken: aaveContractAddresses.aToken.WETH,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                    FEE_3000,
                                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                                ]),
                                amountOutMinimum: 0
                            }
                        },
                        {
                            aToken: aaveContractAddresses.aToken.WBTC,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                    FEE_3000,
                                    ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                                ]),
                                amountOutMinimum: 0
                            }
                        },
                        {
                            aToken: aaveContractAddresses.aToken.weETH,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenAddresses.weETH, 20),
                                    FEE_3000,
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

                const flashAmount = parseUnits("435", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

                await expect(
                    migratorV2
                        .connect(user)
                        .migrate(
                            aaveV3Adapter.address,
                            compoundContractAddresses.markets.cUSDCv3,
                            migrationData,
                            flashAmount
                        )
                )
                    .to.emit(migratorV2, "MigrationExecuted")
                    .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

                const userBalancesAfter = {
                    collateralsAave: {
                        ETH: await aTokenContracts.WETH.balanceOf(user.address),
                        WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                        weETH: await aTokenContracts.weETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                        SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                        wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDC: await cUSDCv3Contract.balanceOf(user.address),
                        WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                        WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                    }
                };

                log("userBalancesAfter:", userBalancesAfter);

                // all borrows should be closed
                expect(userBalancesAfter.borrowAave.SCR).to.be.equal(Zero);
                expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
                expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
                //all collaterals should be migrated
                expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
                expect(userBalancesAfter.collateralsAave.weETH).to.be.equal(Zero);
                expect(userBalancesAfter.collateralsAave.ETH).to.be.equal(Zero);
                // all collaterals from Aave should be migrated to Comet as USDC
                expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
            }
        ).timeout(0);

        it("Scn.#2: partial collateral migration (by asset types)| three collateral and three borrow tokens | only swaps (coll. & borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseEther("0.05"), // 130 USD
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                weETH: parseUnits("300", tokenDecimals.weETH)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                WETH: fundingData.WETH, // 130 USD
                WBTC: fundingData.WBTC, // 955 USD
                weETH: fundingData.weETH // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 625 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC),
                SCR: parseUnits("70", tokenDecimals.SCR),
                wstETH: parseUnits("30", tokenDecimals.wstETH) // ~555 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            await aTokenContracts.WBTC.approve(migratorV2.address, MaxUint256);

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    weETH: await aTokenContracts.weETH.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("555", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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

            const flashAmount = parseUnits("555", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    weETH: await aTokenContracts.weETH.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.SCR).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.weETH).to.be.not.equal(Zero);
            expect(userBalancesAfter.collateralsAave.ETH).to.be.not.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as WBTC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#3: migration of all collaterals | two collateral and two borrow tokens (incl. native token) | only swaps (coll. & borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                weETH: parseUnits("300", tokenDecimals.weETH)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                weETH: fundingData.weETH // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 200 USD
            const borrowAmounts = {
                SCR: parseUnits("70", tokenDecimals.SCR),
                ETH: parseEther("0.05") // ~130 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                if (token === "ETH") {
                    // supply ETH as collateral
                    const wrappedTokenGateway = IWrappedTokenGatewayV3__factory.connect(
                        aaveContractAddresses.wrappedTokenGateway,
                        user
                    );
                    // approve delegation of ETH to WrappedTokenGateway contract
                    await debtTokenContracts.WETH.approveDelegation(wrappedTokenGateway.address, MaxUint256);

                    await wrappedTokenGateway.borrowETH(aaveV3Pool.address, amount, referralCode);
                } else {
                    await aaveV3Pool.borrow(
                        tokenAddresses[token],
                        amount,
                        interestRateMode,
                        referralCode,
                        user.address
                    );
                }
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    weETH: await aTokenContracts.weETH.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.SCR,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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
                        aToken: aaveContractAddresses.aToken.weETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.weETH, 20),
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

            const flashAmount = parseUnits("200", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    weETH: await aTokenContracts.weETH.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.SCR).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.ETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.weETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#4: migration of all collaterals | one collateral and one borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 250 USD
            const borrowAmounts = {
                USDC: parseUnits("250", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

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

            const flashAmount = parseUnits("250", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as WBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
        }).timeout(0);

        it("Scn.#5: migration of all collaterals | one collateral and one borrow tokens | only swaps (borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 150 USD
            const borrowAmounts = {
                SCR: parseUnits("100", tokenDecimals.SCR)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.SCR,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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

            const flashAmount = parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.SCR).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as WBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
        }).timeout(0);

        it("Scn.#6: migration of all collaterals | one collateral and two borrow tokens | only swaps (borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                SCR: parseUnits("70", tokenDecimals.SCR),
                USDC: parseUnits("45", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.SCR,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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

            const flashAmount = parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.SCR).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as WBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
        }).timeout(0);

        it("Scn.#7: migration of all collaterals | one collateral and one borrow tokens | only swaps (coll. & barrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                SCR: parseUnits("100", tokenDecimals.SCR)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [
                    {
                        aDebtToken: aaveContractAddresses.variableDebtToken.SCR,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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

            const flashAmount = parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    SCR: await debtTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.SCR).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#8: migration of all collaterals | one collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 955 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

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

            const flashAmount = parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#9: migration of all collaterals | tow collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                weETH: parseUnits("100", tokenDecimals.weETH)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                weETH: fundingData.weETH // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

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
                        aToken: aaveContractAddresses.aToken.weETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.weETH, 20),
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

            const flashAmount = parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#10: migration of all collaterals | two collateral without borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDC: parseUnits("100", tokenDecimals.USDC)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                USDC: fundingData.USDC // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDC,
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

            const flashAmount = Zero;

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralAave.USDC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#11: migration of all collaterals | two collateral without borrow tokens | only swaps (single-hop route)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                weETH: parseUnits("100", tokenDecimals.weETH)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                weETH: fundingData.weETH // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [],
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
                        aToken: aaveContractAddresses.aToken.weETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.weETH, 20),
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

            const flashAmount = Zero;

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#12: migration of all collaterals | two collateral without borrow tokens | only swaps (multi-hop route)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                aaveContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                SCR: parseUnits("3500", tokenDecimals.SCR)
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // setup the collateral and borrow positions in AaveV3
            const aaveV3Pool = IAavePool__factory.connect(aaveContractAddresses.pool, user);

            const referralCode = 0;

            // total supply amount equivalent to 4455 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                SCR: fundingData.SCR // 3500 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    SCR: await aTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const FEE_3000 = 3000; // 0.3%
            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8

            const position = {
                borrows: [],
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
                        aToken: aaveContractAddresses.aToken.SCR,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.SCR, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
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

            const flashAmount = Zero;

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    SCR: await aTokenContracts.SCR.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralAave.SCR).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);
    });
});
