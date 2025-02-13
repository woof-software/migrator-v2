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
    IComet__factory,
    ERC20__factory,
    ERC20,
    IAToken__factory,
    IAToken,
    IDebtToken__factory,
    IDebtToken
} from "../../../../typechain-types";

import { AavePool__factory, WrappedTokenGatewayV3__factory } from "../../types/contracts";

/**
 *  **Fork Tests: How to Run**
 *
 *  **Fill in the `.env` file** according to the provided example, specifying correct RPC URLs and fork block numbers.
 *
 *  **Running Fork Tests**
 *    - The main command to execute a fork test:
 *      ```sh
 *      npm run test-f-aave --fork-network=base
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),  
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-aave --debug-log=true --fork-network=base
 *      ```
 *
 *  **How Fork Tests Work**
 *    - The tests run on a **fixed block number** defined in the `.env` file.
 *    - **To execute tests on the latest network block**, remove the `FORKING_BASE_BLOCK` variable from `.env`:
 *      ```env
 *      # Remove or comment out this line:
 *      # FORKING_BASE_BLOCK=
 *      ```
 */

// Convert fee to 3-byte hex
const FEE_3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0.3% 0x0BB8
const FEE_500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(500), 3); // 0.05% 0x01F4
const FEE_100 = ethers.utils.hexZeroPad(ethers.utils.hexlify(100), 3); // 0.01% 0x0064

const POSITION_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

describe("MigratorV2 and AaveV3Adapter contracts", function () {
    async function setupEnv() {
        const [owner, user] = await ethers.getSigners();
        console.log("Network:", process.env.npm_config_fork_network || "not set");
        console.log("Block number:", await ethers.provider.getBlockNumber());

        const tokenAddresses: Record<string, string> = {
            cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
            USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
            WETH: "0x4200000000000000000000000000000000000006",
            USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
            wstETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"
        };

        const treasuryAddresses: Record<string, string> = {
            cbBTC: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            USDC: "0x0B0A5886664376F59C351ba3f598C8A8B4D0A6f3",
            cbETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            WETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            USDbC: "0x4c80E24119CFB836cdF0a6b53dc23F04F7e652CA",
            wstETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
        };

        const aaveContractAddresses = {
            aToken: {
                cbBTC: "0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6",
                USDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
                cbETH: "0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad",
                WETH: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7",
                USDbC: "0x0a1d576f3eFeF75b330424287a95A366e8281D54",
                wstETH: "0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D"
            },
            variableDebtToken: {
                cbBTC: "0x05e08702028de6AaD395DC6478b554a56920b9AD",
                USDC: "0x59dca05b6c26dbd64b5381374aAaC5CD05644C28",
                cbETH: "0x1DabC36f19909425f654777249815c073E8Fd79F",
                WETH: "0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E",
                USDbC: "0x7376b2F323dC56fCd4C191B34163ac8a84702DAB",
                wstETH: "0x41A7C3f5904ad176dACbb1D99101F59ef0811DC1"
            },
            pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            protocolDataProvider: "0xd82a47fdebB5bf5329b09441C3DaB4b5df2153Ad",
            wrappedTokenGateway: "0x729b3EA8C005AbC58c9150fb57Ec161296F06766"
        };

        const uniswapContractAddresses = {
            router: "0x2626664c2603336E57B271c5C0b26F421741e481",
            pools: {
                USDC_USDT: "0xD56da2B74bA826f19015E6B7Dd9Dae1903E85DA1" // 0.01% fee
            }
        };

        const compoundContractAddresses = {
            markets: {
                cUSDCv3: "0xb125E6687d4313864e53df431d5425969c15Eb2F"
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

        // const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3AdapterBase", owner);
        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", owner);
        const aaveV3Adapter = await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            wrappedNativeToken: tokenAddresses.WETH,
            aaveLendingPool: aaveContractAddresses.pool,
            aaveDataProvider: aaveContractAddresses.protocolDataProvider,
            isFullMigration: true
        });
        await aaveV3Adapter.deployed();

        const adapters = [aaveV3Adapter.address];
        const comets = [compoundContractAddresses.markets.cUSDCv3]; // Compound USDC (cUSDCv3) market

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: uniswapContractAddresses.pools.USDC_USDT, // Uniswap V3 pool USDC / cbETH
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

        // Connecting to all necessary contracts for testing
        const aaveV3Pool = AavePool__factory.connect(aaveContractAddresses.pool, user);

        const wrappedTokenGateway = WrappedTokenGatewayV3__factory.connect(
            aaveContractAddresses.wrappedTokenGateway,
            user
        );

        const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

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
            migratorV2,
            aaveV3Pool,
            wrappedTokenGateway,
            cUSDCv3Contract
        };
    }

    context("Migrate positions from AaveV3 to Compound III", function () {
        it("Scn.#1: migration of all collaterals | three collateral (incl. Native Token) and three borrow tokens | only swaps (coll. & borrow pos.)", async function () {
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract,
                wrappedTokenGateway
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDbC: parseUnits("300", tokenDecimals.USDbC) // ~ 300 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                ETH: parseEther("0.05"), // ~130 USD
                cbBTC: fundingData.cbBTC, // ~955 USD
                USDbC: fundingData.USDbC // ~300 USD
            };

            // supply ETH as collateral
            for (const [token, amount] of Object.entries(supplyAmounts)) {
                if (token === "ETH") {
                    await wrappedTokenGateway.depositETH(aaveV3Pool.address, user.address, referralCode, {
                        value: supplyAmounts.ETH
                    });
                } else {
                    await tokenContracts[token].approve(aaveV3Pool.address, amount);
                    await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
                }
            }

            // total borrow amount equivalent to 505 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC), // ~100 USD
                wstETH: parseUnits("0.05", tokenDecimals.wstETH), // ~150 USD
                cbETH: parseUnits("0.09", tokenDecimals.cbETH) // ~265 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);

                // await debtTokenContracts[token].approveDelegation(migratorV2.address, MaxUint256);
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    cbETH: await debtTokenContracts.cbETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.cbETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDbC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDbC, 20),
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

            const flashAmount = parseUnits("515", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    cbETH: await debtTokenContracts.cbETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.cbETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.ETH).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDbC).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#2: partial collateral migration (by asset types)| three collateral and three borrow tokens | only swaps (borrow pos.)", async function () {
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseEther("0.5"), // ~1340 USD
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 975 USD
                USDbC: parseUnits("300", tokenDecimals.USDbC) // ~ 300 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 2615 USD
            const supplyAmounts = {
                WETH: fundingData.WETH, // 1340 USD
                cbBTC: fundingData.cbBTC, // 975 USD
                USDbC: fundingData.USDbC // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 505 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC), // ~100 USD
                wstETH: parseUnits("0.05", tokenDecimals.wstETH), // ~140 USD
                cbETH: parseUnits("0.09", tokenDecimals.cbETH) // ~265 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            await aTokenContracts.cbBTC.approve(migratorV2.address, MaxUint256);

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    cbETH: await debtTokenContracts.cbETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.cbETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
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

            const flashAmount = parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    cbETH: await debtTokenContracts.cbETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.cbETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.ETH).to.be.not.equal(Zero);
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDbC).to.be.not.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract,
                wrappedTokenGateway
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDbC: parseUnits("300", tokenDecimals.USDbC) // ~ 300 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                USDbC: fundingData.USDbC // ~300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 270 USD
            const borrowAmounts = {
                wstETH: parseUnits("0.05", tokenDecimals.wstETH), // ~150 USD
                ETH: parseEther("0.05") // ~130 USD
            };

            // borrow ETH as collateral
            for (const [token, amount] of Object.entries(borrowAmounts)) {
                if (token === "ETH") {
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDbC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDbC, 20),
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

            const flashAmount = parseUnits("280", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.ETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDbC).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 140 USD
            const borrowAmounts = {
                wstETH: parseUnits("0.05", tokenDecimals.wstETH) // ~150 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
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

            const flashAmount = parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 185 USD
            const borrowAmounts = {
                wstETH: parseUnits("0.05", tokenDecimals.wstETH), // ~150 USD
                USDC: parseUnits("45", tokenDecimals.USDC) // ~45 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
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

            const flashAmount = parseUnits("195", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 140 USD
            const borrowAmounts = {
                wstETH: parseUnits("0.05", tokenDecimals.wstETH) // ~150 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
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

            const flashAmount = parseUnits("150", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 955 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDbC: parseUnits("100", tokenDecimals.USDbC) // ~100 USD
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
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                USDbC: fundingData.USDbC // ~100 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDbC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDbC, 20),
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
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDbC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDC: parseUnits("100", tokenDecimals.USDC) // ~100 USD
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
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                USDC: fundingData.USDC // ~100 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
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
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                cbETH: parseUnits("0.09", tokenDecimals.cbETH) // ~265 USD
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
            const referralCode = 0;

            // total supply amount equivalent to 1220 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                cbETH: fundingData.cbETH // ~265 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.cbETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
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
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
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
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDbC: parseUnits("3500", tokenDecimals.USDbC) // ~ 3500 USD
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
            const referralCode = 0;

            // total supply amount equivalent to 4455 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // 955 USD
                USDbC: fundingData.USDbC // 3500 USD
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDbC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDbC, 20),
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
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDbC: await aTokenContracts.USDbC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDbC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);
    });
});
