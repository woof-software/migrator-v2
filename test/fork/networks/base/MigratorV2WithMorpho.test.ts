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
    logger,
    BigNumber,
    AddressZero
} from "../../../helpers"; // Adjust the path as needed

import { MigratorV2, MorphoAdapter, ERC20__factory, IComet__factory, ERC20 } from "../../../../typechain-types";

import { MorphoPool__factory } from "../../types/contracts";

/**
 *  **Fork Tests: How to Run**
 *
 *  **Fill in the `.env` file** according to the provided example, specifying correct RPC URLs and fork block numbers.
 *
 *  **Running Fork Tests**
 *    - The main command to execute a fork test:
 *      ```sh
 *      npm run test-f-morpho --fork-network=base
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-morpho --debug-log=true --fork-network=base
 *      ```
 *
 *  **How Fork Tests Work**
 *    - The tests run on a **fixed block number** defined in the `.env` file.
 *    - **To execute tests on the latest network block**, remove the `FORKING_ETHEREUM_BLOCK` variable from `.env`:
 *      ```env
 *      # Remove or comment out this line:
 *      # FORKING_ETHEREUM_BLOCK=
 *      ```
 */

// Convert fee to 3-byte hex
const FEE_3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0.3%
const FEE_500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(500), 3); // 0.05%
const FEE_100 = ethers.utils.hexZeroPad(ethers.utils.hexlify(100), 3); // 0.01%

const POSITION_ABI = [
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

describe("MigratorV2 and MorphoAdapter contracts", function () {
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
            wstETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
            EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"
        };

        const treasuryAddresses: Record<string, string> = {
            cbBTC: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            USDC: "0x0B0A5886664376F59C351ba3f598C8A8B4D0A6f3",
            cbETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            WETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            USDbC: "0x4c80E24119CFB836cdF0a6b53dc23F04F7e652CA",
            wstETH: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
            EURC: "0x7b2c99188D8EC7B82d6b3b3b1C1002095F1b8498"
        };

        const morphoContractAddresses: Record<string, string> = {
            pool: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
        };

        const morphoMarketsData: Record<string, { id: string; loanToken: string }> = {
            wstETH: {
                id: "0xf7e40290f8ca1d5848b3c129502599aa0f0602eb5f5235218797a34242719561",
                loanToken: "EURC"
            },
            cbETH: {
                id: "0x1c21c59df9db44bf6f645d854ee710a8ca17b479451447e9f56758aee10a2fad",
                loanToken: "USDC"
            },
            WETH: {
                id: "0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda",
                loanToken: "USDC"
            },
            cbBTC: {
                id: "0x5dffffc7d75dc5abfa8dbe6fad9cbdadf6680cbe1428bafe661497520c84a94c",
                loanToken: "WETH"
            }
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

        const MorphoAdapterFactory = await ethers.getContractFactory("MorphoAdapter", owner);
        const morphoAdapter = (await MorphoAdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            // wrappedNativeToken: tokenAddresses.WETH,
            morphoLendingPool: morphoContractAddresses.pool,
            isFullMigration: true,
            useSwapRouter02: true
        })) as MorphoAdapter;
        await morphoAdapter.deployed();

        const adapters = [morphoAdapter.address];
        const comets = [compoundContractAddresses.markets.cUSDCv3];

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
            flashData,
            AddressZero,
            AddressZero
        )) as MigratorV2;
        await migratorV2.deployed();

        expect(migratorV2.address).to.be.properAddress;

        // Connecting to all necessary contracts for testing
        const morphoPool = MorphoPool__factory.connect(morphoContractAddresses.pool, user);

        const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);

        return {
            owner,
            user,
            treasuryAddresses,
            tokenAddresses,
            tokenContracts,
            tokenDecimals,
            morphoContractAddresses,
            uniswapContractAddresses,
            compoundContractAddresses,
            morphoAdapter,
            migratorV2,
            morphoPool,
            cUSDCv3Contract,
            morphoMarketsData
        };
    }

    context("Migrate positions from Morpho to Compound III", function () {
        it("Scn.#1: migration of all collaterals | three collateral and three borrow tokens | only swaps (coll. & borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                cbETH: parseUnits("0.5", tokenDecimals.cbETH), // ~1300 USD
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to ~3555 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                cbETH: fundingData.cbETH, // ~1300 USD
                wstETH: fundingData.wstETH // ~1300 USD
            };

            // total borrow amount equivalent to 435 USD
            const borrowAmounts: Record<string, BigNumber> = {
                WETH: parseUnits("0.05", tokenDecimals.WETH), // ~130 USD
                USDC: parseUnits("70", tokenDecimals.USDC), // ~70 USD
                EURC: parseUnits("100", tokenDecimals.EURC) // ~100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

            const position = {
                // Setup the borrows to be migrated
                borrows: [
                    {
                        marketId: morphoMarketsData.cbBTC.id, // WETH loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        marketId: morphoMarketsData.cbETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id, // EURC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.EURC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                // Setup the collaterals to be migrated
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.WETH).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.EURC).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.cbETH).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.wstETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.equal(userBalancesBefore.collateralsComet.wstETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#2: partial collateral migration (by asset types)| three collateral and three borrow tokens | only swaps (borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                cbETH: parseUnits("0.5", tokenDecimals.cbETH), // ~1300 USD
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 3555 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                cbETH: fundingData.cbETH, // ~1300 USD
                wstETH: fundingData.wstETH // ~1300 USD
            };

            // total borrow amount equivalent to 435 USD
            const borrowAmounts: Record<string, BigNumber> = {
                WETH: parseUnits("0.05", tokenDecimals.WETH), // ~130 USD
                USDC: parseUnits("70", tokenDecimals.USDC), // ~70 USD
                EURC: parseUnits("100", tokenDecimals.EURC) // ~100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbBTC.id, // WETH loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // part of the borrows should be closed
            expect(userBalancesAfter.borrowMorpho.WETH).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.EURC).to.be.not.equal(Zero);
            // part of the collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.cbETH).to.be.not.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.wstETH).to.be.not.equal(Zero);
            // apart of the collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.equal(userBalancesBefore.collateralsComet.wstETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#3: migration of all collaterals | two collateral and two borrow tokens | only swaps (coll. & borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbETH: parseUnits("0.5", tokenDecimals.cbETH), // ~1300 USD
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 2600 USD
            const supplyAmounts = {
                cbETH: fundingData.cbETH, // ~1300 USD
                wstETH: fundingData.wstETH // ~1300 USD
            };

            // total borrow amount equivalent to 170 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("70", tokenDecimals.USDC), // ~70 USD
                EURC: parseUnits("100", tokenDecimals.EURC) // ~100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                // Setup the borrows to be migrated
                borrows: [
                    {
                        marketId: morphoMarketsData.cbETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id, // EURC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.EURC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                // Setup the collaterals to be migrated
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("170", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares,
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.EURC).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbETH).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.wstETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.equal(userBalancesBefore.collateralsComet.wstETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#4: migration of all collaterals | one collateral and one borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbETH: parseUnits("0.5", tokenDecimals.cbETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 1300 USD
            const supplyAmounts = {
                cbETH: fundingData.cbETH // ~1300 USD
            };

            // total borrow amount equivalent to 70 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("70", tokenDecimals.USDC) // ~70 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
                        }
                    }
                ]
            };

            // Encode the data
            const migrationData = ethers.utils.defaultAbiCoder.encode(
                ["tuple(" + POSITION_ABI.join(",") + ")"],
                [[position.borrows, position.collaterals]]
            );

            const flashAmount = parseUnits("135", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.cbETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as cbETH
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.above(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#5: migration of all collaterals | one collateral and one borrow tokens | only swaps (borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC) // ~ 955 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 955 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // ~955 USD
            };
            // total borrow amount equivalent to 130 USD
            const borrowAmounts: Record<string, BigNumber> = {
                WETH: parseUnits("0.05", tokenDecimals.WETH) // ~130 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbBTC.id, // WETH loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral
                },
                borrowMorpho: {
                    WETH: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.WETH).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as cbBTC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
        }).timeout(0);

        it("Scn.#6: migration of all collaterals | one collateral and one borrow tokens | only swaps (coll. & barrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                wstETH: fundingData.wstETH // ~1300 USD
            };
            // total borrow amount equivalent to 130 USD
            const borrowAmounts: Record<string, BigNumber> = {
                EURC: parseUnits("100", tokenDecimals.EURC) // ~100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.wstETH.id, // EURC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.EURC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    EURC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.EURC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.wstETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.equal(userBalancesBefore.collateralsComet.wstETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#7: migration of all collaterals | one collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbETH: parseUnits("0.5", tokenDecimals.cbETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 1300 USD
            const supplyAmounts = {
                cbETH: fundingData.cbETH // ~1300 USD
            };

            // total borrow amount equivalent to 250 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("250", tokenDecimals.USDC) // ~250 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                await morphoPool
                    .borrow(
                        marketParams,
                        borrowAmounts[morphoMarketsData[token].loanToken],
                        Zero,
                        user.address,
                        user.address
                    )
                    .then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.cbETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#8: migration of all collaterals | tow collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                cbETH: parseUnits("0.5", tokenDecimals.cbETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 2255 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                cbETH: fundingData.cbETH // ~1300 USD
            };
            // total borrow amount equivalent to 150 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("150", tokenDecimals.USDC) // ~150 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());

                const borrowAmount = borrowAmounts[morphoMarketsData[token].loanToken] ?? Zero;
                if (!borrowAmount.isZero()) {
                    await morphoPool
                        .borrow(marketParams, borrowAmount, Zero, user.address, user.address)
                        .then((tx) => tx.wait());
                }
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.cbETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#9: migration of all collaterals | two collateral without borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 2255 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // ~955 USD
                wstETH: fundingData.wstETH // ~1300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.wstETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as WBTC and LINK
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.above(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.above(userBalancesBefore.collateralsComet.wstETH);

            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#10: migration of all collaterals | one collateral without borrow tokens | only swaps (single-hop route)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.1", tokenDecimals.cbBTC) // ~ 9550 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 1485 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // ~955 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbBTC: (await morphoPool.position(morphoMarketsData.cbBTC.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#11: migration of all collaterals | two collateral without borrow tokens | only swaps (multi-hop route)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbETH: parseUnits("0.5", tokenDecimals.cbETH), // ~1300 USD
                wstETH: parseUnits("0.5", tokenDecimals.wstETH) // ~1300 USD
            };
            // --- start
            for (const [token, amount] of Object.entries(fundingData)) {
                const tokenContract = tokenContracts[token];
                const treasuryAddress = treasuryAddresses[token];
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

                await setBalance(treasuryAddress, parseEther("1000"));
                await impersonateAccount(treasuryAddress);
                const treasurySigner = await ethers.getSigner(treasuryAddress);

                await tokenContract.connect(treasurySigner).transfer(user.address, amount);
                await stopImpersonatingAccount(treasuryAddress);
            }
            // --- end

            // total supply amount equivalent to 2600 USD
            const supplyAmounts = {
                cbETH: fundingData.cbETH, // ~1300 USD
                wstETH: fundingData.wstETH // ~1300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(morphoPool.address, amount);

                const marketParams: {
                    loanToken: string;
                    collateralToken: string;
                    oracle: string;
                    irm: string;
                    lltv: BigNumber;
                } = await morphoPool.idToMarketParams(morphoMarketsData[token].id);

                await morphoPool.supplyCollateral(marketParams, amount, user.address, "0x").then((tx) => tx.wait());
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.cbETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
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

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsMorpho: {
                    cbETH: (await morphoPool.position(morphoMarketsData.cbETH.id, user.address)).collateral,
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbETH),
                    wstETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.cbETH).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.wstETH).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbETH).to.be.equal(userBalancesBefore.collateralsComet.cbETH);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.equal(userBalancesBefore.collateralsComet.wstETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);
    });
});
