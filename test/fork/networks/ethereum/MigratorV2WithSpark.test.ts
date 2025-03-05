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
    SparkAdapter,
    ERC20__factory,
    IComet__factory,
    ERC20,
    ISpToken__factory,
    ISpToken,
    IDebtToken__factory,
    IDebtToken
} from "../../../../typechain-types";

import { SparkPool__factory, WETHGateway__factory } from "../../types/contracts";

/**
 *  **Fork Tests: How to Run**
 *
 *  **Fill in the `.env` file** according to the provided example, specifying correct RPC URLs and fork block numbers.
 *
 *  **Running Fork Tests**
 *    - The main command to execute a fork test:
 *      ```sh
 *      npm run test-f-spark --fork-network=ethereum
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-spark --debug-log=true --fork-network=ethereum
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

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

const POSITION_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
    "tuple(address spToken, uint256 amount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

describe("MigratorV2 and SparkAdapter contracts", function () {
    async function setupEnv() {
        const [owner, user] = await ethers.getSigners();
        console.log("Network:", process.env.npm_config_fork_network || "not set");
        console.log("Block number:", await ethers.provider.getBlockNumber());

        const tokenAddresses: Record<string, string> = {
            WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            USDS: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
            WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            GNO: "0x6810e776880C02933D47DB1b9fc05908e5386b96",
            wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
            sDAI: "0x83F20F44975D03b1b09e64809B757c47f942BEeA"
        };

        const treasuryAddresses: Record<string, string> = {
            WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            DAI: "0xD1668fB5F690C59Ab4B0CAbAd0f8C1617895052B",
            USDC: "0xC8e2C09A252ff6A41F82B4762bB282fD0CEA2280",
            USDT: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            USDS: "0x1AB4973a48dc892Cd9971ECE8e01DcC7688f8F23",
            WETH: "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
            GNO: "0x70e278941eD3C0D2c6D6105df184831992ACA856",
            wstETH: "0xacB7027f271B03B502D65fEBa617a0d817D62b8e",
            cbBTC: "0x698C1f4c8db11629fDC913F54A6dC44a9166F187",
            sDAI: "0x15a8B2ceA2D8f48c150f2EC7be07808c54355Bc7"
        };

        const sparkContractAddresses = {
            spToken: {
                WBTC: "0x4197ba364AE6698015AE5c1468f54087602715b2",
                DAI: "0x4DEDf26112B3Ec8eC46e7E31EA5e123490B05B8B",
                USDC: "0x377C3bd93f2a2984E1E7bE6A5C22c525eD4A4815",
                USDT: "0xe7dF13b8e3d6740fe17CBE928C7334243d86c92f",
                USDS: "0xC02aB1A5eaA8d1B114EF786D9bde108cD4364359",
                WETH: "0x59cD1C87501baa753d0B5B5Ab5D8416A45cD71DB",
                GNO: "0x7b481aCC9fDADDc9af2cBEA1Ff2342CB1733E50F",
                wstETH: "0x12B54025C112Aa61fAce2CDB7118740875A566E9",
                cbBTC: "0xb3973D459df38ae57797811F2A1fd061DA1BC123",
                sDAI: "0x78f897F0fE2d3B5690EbAe7f19862DEacedF10a7"
            },
            variableDebtToken: {
                WBTC: "0xf6fEe3A8aC8040C3d6d81d9A4a168516Ec9B51D2",
                DAI: "0xf705d2B7e92B3F38e6ae7afaDAA2fEE110fE5914",
                USDC: "0x7B70D04099CB9cfb1Db7B6820baDAfB4C5C70A67",
                USDT: "0x529b6158d1D2992E3129F7C69E81a7c677dc3B12",
                USDS: "0x8c147debea24Fb98ade8dDa4bf142992928b449e",
                WETH: "0x2e7576042566f8D6990e07A1B61Ad1efd86Ae70d",
                GNO: "0x57a2957651DA467fCD4104D749f2F3684784c25a",
                wstETH: "0xd5c3E3B566a42A6110513Ac7670C1a86D76E13E6",
                cbBTC: "0x661fE667D2103eb52d3632a3eB2cAbd123F27938",
                sDAI: "0xaBc57081C04D921388240393ec4088Aa47c6832B"
            },
            pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987",
            protocolDataProvider: "0xFc21d6d146E6086B8359705C8b28512a983db0cb",
            wrappedTokenGateway: "0xBD7D6a9ad7865463DE44B05F04559f65e3B11704"
        };

        // convertor Dai to Usds address
        const daiUsdsAddress = "0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A";

        const uniswapContractAddresses = {
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            pools: {
                USDC_USDT: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6",
                DAI_USDS: "0xe9F1E2EF814f5686C30ce6fb7103d0F780836C67"
            }
        };

        const compoundContractAddresses = {
            markets: {
                cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
                cUSDSv3: "0x5D409e56D886231aDAf00c8775665AD0f9897b56"
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

        const aTokenContracts: Record<string, ISpToken> = Object.fromEntries(
            Object.entries(sparkContractAddresses.spToken).map(([symbol, address]) => [
                symbol,
                ISpToken__factory.connect(address, user)
            ])
        );

        const debtTokenContracts: Record<string, IDebtToken> = Object.fromEntries(
            Object.entries(sparkContractAddresses.variableDebtToken).map(([symbol, address]) => [
                symbol,
                IDebtToken__factory.connect(address, user)
            ])
        );

        const SparkAdapterFactory = await ethers.getContractFactory("SparkUsdsAdapter", owner);
        const sparkAdapter = (await SparkAdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            daiUsdsConverter: daiUsdsAddress,
            dai: tokenAddresses.DAI,
            usds: tokenAddresses.USDS,
            wrappedNativeToken: tokenAddresses.WETH,
            sparkLendingPool: sparkContractAddresses.pool,
            sparkDataProvider: sparkContractAddresses.protocolDataProvider,
            isFullMigration: true
        })) as SparkAdapter;
        await sparkAdapter.deployed();

        const adapters = [sparkAdapter.address];
        const comets = [compoundContractAddresses.markets.cUSDCv3, compoundContractAddresses.markets.cUSDSv3];

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: uniswapContractAddresses.pools.USDC_USDT, // Uniswap V3 pool USDC / USDT
                baseToken: tokenAddresses.USDC, // USDC
                isToken0: true
            },
            {
                liquidityPool: uniswapContractAddresses.pools.DAI_USDS, // Uniswap V3 pool DAI / USDS
                baseToken: tokenAddresses.USDS, // USDS
                isToken0: false
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
        const sparkPool = SparkPool__factory.connect(sparkContractAddresses.pool, user);

        const wrappedTokenGateway = WETHGateway__factory.connect(sparkContractAddresses.wrappedTokenGateway, user);

        const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);
        const cUSDSv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDSv3, user);

        return {
            owner,
            user,
            treasuryAddresses,
            tokenAddresses,
            tokenContracts,
            tokenDecimals,
            sparkContractAddresses,
            aTokenContracts,
            debtTokenContracts,
            uniswapContractAddresses,
            compoundContractAddresses,
            daiUsdsAddress,
            sparkAdapter,
            migratorV2,
            sparkPool,
            wrappedTokenGateway,
            cUSDCv3Contract,
            cUSDSv3Contract
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.03", tokenDecimals.cbBTC), // ~ 2950 USD
                USDT: parseUnits("300", tokenDecimals.USDT)
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

            // total supply amount equivalent to 3380 USD
            const supplyAmounts = {
                ETH: parseEther("0.05"), // 130 USD
                cbBTC: fundingData.cbBTC, // 2950 USD
                USDT: fundingData.USDT // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                if (token === "ETH") {
                    // supply ETH as collateral
                    const wrappedTokenGateway = WETHGateway__factory.connect(
                        sparkContractAddresses.wrappedTokenGateway,
                        user
                    );
                    await wrappedTokenGateway.depositETH(sparkPool.address, user.address, referralCode, {
                        value: supplyAmounts.ETH
                    });
                } else {
                    await tokenContracts[token].approve(sparkPool.address, amount);
                    await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
                }
            }

            // total borrow amount equivalent to 1420 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC), // ~100 USD
                DAI: parseUnits("700", tokenDecimals.DAI), // ~700 USD
                wstETH: parseUnits("0.2", tokenDecimals.wstETH) // ~620 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
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
                        debtToken: sparkContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    },
                    {
                        debtToken: sparkContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("700", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: sparkContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("620", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.WETH,
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
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        spToken: sparkContractAddresses.spToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            const flashAmount = parseUnits("1420", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.ETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#2: partial collateral migration (by asset types)| three collateral and three borrow tokens | only swaps (coll. & borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseEther("0.5"), // ~ 1350 USD
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDT: parseUnits("300", tokenDecimals.USDT) // ~ 300 USD
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

            // total supply amount equivalent to 2605 USD
            const supplyAmounts = {
                WETH: fundingData.WETH, // ~1350 USD
                cbBTC: fundingData.cbBTC, // ~955 USD
                USDT: fundingData.USDT // ~300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 480 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC), // ~100 USD
                DAI: parseUnits("70", tokenDecimals.DAI), // ~70 USD
                wstETH: parseUnits("0.1", tokenDecimals.wstETH) // ~310 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            await aTokenContracts.cbBTC.approve(migratorV2.address, MaxUint256);

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address),
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
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
                        debtToken: sparkContractAddresses.variableDebtToken.wstETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.wstETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("310", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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

            const flashAmount = parseUnits("310", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address),
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    wstETH: await debtTokenContracts.wstETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.wstETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.not.equal(Zero);
            expect(userBalancesAfter.collateralsAave.WETH).to.be.not.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                wrappedTokenGateway,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDT: parseUnits("300", tokenDecimals.USDT)
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
                cbBTC: fundingData.cbBTC, // 955 USD
                USDT: fundingData.USDT // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 200 USD
            const borrowAmounts = {
                DAI: parseUnits("70", tokenDecimals.DAI),
                ETH: parseEther("0.05") // ~130 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                if (token === "ETH") {
                    // approve delegation of ETH to WrappedTokenGateway contract
                    await debtTokenContracts.WETH.approveDelegation(wrappedTokenGateway.address, MaxUint256);

                    await wrappedTokenGateway.borrowETH(sparkPool.address, amount, interestRateMode, referralCode);
                } else {
                    await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
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
                        debtToken: sparkContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: sparkContractAddresses.variableDebtToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        spToken: sparkContractAddresses.spToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            const flashAmount = parseUnits("200", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.ETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
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
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 250 USD
            const borrowAmounts = {
                USDC: parseUnits("250", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                        debtToken: sparkContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
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
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 150 USD
            const borrowAmounts = {
                DAI: parseUnits("100", tokenDecimals.DAI)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
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
                        debtToken: sparkContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("130", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
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
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                DAI: parseUnits("70", tokenDecimals.DAI),
                USDC: parseUnits("45", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
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
                        debtToken: sparkContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: sparkContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
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
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                DAI: parseUnits("100", tokenDecimals.DAI)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
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
                        debtToken: sparkContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("100", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    cbBTC: await aTokenContracts.cbBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    cbBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.cbBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
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
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                        debtToken: sparkContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.cbBTC, 20),
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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
                sparkContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDT: parseUnits("100", tokenDecimals.USDT)
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
                cbBTC: fundingData.cbBTC, // 955 USD
                USDT: fundingData.USDT // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 115 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await sparkPool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                        debtToken: sparkContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        spToken: sparkContractAddresses.spToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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

        it("Scn.#10: migration of all collaterals | two collateral without borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                sparkContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
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
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC, // 955 USD
                USDC: fundingData.USDC // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
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
                        spToken: sparkContractAddresses.spToken.cbBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    },
                    {
                        spToken: sparkContractAddresses.spToken.USDC,
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralAave: {
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
            expect(userBalancesAfter.collateralAave.cbBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralAave.USDC).to.be.equal(Zero);
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
                sparkContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.cbBTC), // ~ 955 USD
                USDT: parseUnits("100", tokenDecimals.USDT)
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
                cbBTC: fundingData.cbBTC, // 955 USD
                USDT: fundingData.USDT // 100 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
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
                        spToken: sparkContractAddresses.spToken.cbBTC,
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
                        spToken: sparkContractAddresses.spToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

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
                sparkContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                DAI: parseUnits("3500", tokenDecimals.DAI)
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
                WBTC: fundingData.WBTC, // 955 USD
                DAI: fundingData.DAI // 3500 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
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
                        spToken: sparkContractAddresses.spToken.WBTC,
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
                        spToken: sparkContractAddresses.spToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralAave.DAI).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#13: migration of all collaterals | one collateral without borrow tokens | only conversion ", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                sparkContractAddresses,
                aTokenContracts,
                compoundContractAddresses,
                sparkAdapter,
                migratorV2,
                sparkPool,
                cUSDSv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                DAI: parseUnits("500", tokenDecimals.DAI) // ~ 500 USD
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

            // total supply amount equivalent to 500 USD
            const supplyAmounts = {
                DAI: fundingData.DAI // ~500 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(sparkPool.address, amount);
                await sparkPool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDSv3
            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        spToken: sparkContractAddresses.spToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                ethers.utils.hexZeroPad(tokenAddresses.USDS, 20)
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
                        sparkAdapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(sparkAdapter.address, user.address, cUSDSv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralsAave: {
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDS
            expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
        }).timeout(0);
    });
});
