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
    AddressZero,
    formatUnits
} from "../../../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    AaveV3UsdsAdapter,
    IComet__factory,
    ERC20__factory,
    ERC20,
    IAToken__factory,
    IAToken,
    IDebtToken__factory,
    IDebtToken,
    UniswapV3PathFinder__factory,
    UniswapV3PathFinder
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
 *      npm run test-f-aave --fork-network=optimism
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-aave --debug-log=true --fork-network=optimism
 *      ```
 *
 *  **How Fork Tests Work**
 *    - The tests run on a **fixed block number** defined in the `.env` file.
 *    - **To execute tests on the latest network block**, remove the `FORKING_OPTIMISM_BLOCK` variable from `.env`:
 *      ```env
 *      # Remove or comment out this line:
 *      # FORKING_OPTIMISM_BLOCK=
 *      ```
 */

// Convert fee to 3-byte hex
const FEE_3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0.3%
const FEE_500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(500), 3); // 0.05%
const FEE_100 = ethers.utils.hexZeroPad(ethers.utils.hexlify(100), 3); // 0.01%

const POSITION_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

describe("MigratorV2 and AaveV3UsdsAdapter contracts", function () {
    async function setupEnv() {
        const [owner, user] = await ethers.getSigners();
        console.log("Network:", process.env.npm_config_fork_network || "not set");
        console.log("Block number:", await ethers.provider.getBlockNumber());

        const tokenAddresses: Record<string, string> = {
            WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
            DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
            USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
            USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
            WETH: "0x4200000000000000000000000000000000000006",
            LINK: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6"
        };

        const treasuryAddresses: Record<string, string> = {
            WBTC: "0x1eED63EfBA5f81D95bfe37d82C8E736b974F477b",
            DAI: "0x1eED63EfBA5f81D95bfe37d82C8E736b974F477b",
            USDC: "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0",
            USDT: "0xacD03D601e5bB1B275Bb94076fF46ED9D753435A",
            WETH: "0x86Bb63148d17d445Ed5398ef26Aa05Bf76dD5b59",
            LINK: "0x0172e05392aba65366C4dbBb70D958BbF43304E4"
        };

        const aaveContractAddresses = {
            aToken: {
                WBTC: "0x078f358208685046a11C85e8ad32895DED33A249",
                DAI: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
                USDC: "0x38d693cE1dF5AaDF7bC62595A37D667aD57922e5",
                USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
                WETH: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
                LINK: "0x191c10Aa4AF7C30e871E70C95dB0E4eb77237530"
            },
            variableDebtToken: {
                WBTC: "0x92b42c66840C7AD907b4BF74879FF3eF7c529473",
                DAI: "0x8619d80FB0141ba7F184CbF22fd724116D9f7ffC",
                USDC: "0x5D557B07776D12967914379C71a1310e917C7555",
                USDT: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
                WETH: "0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351",
                LINK: "0x953A573793604aF8d41F306FEb8274190dB4aE0e"
            },
            pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            protocolDataProvider: "0x7F23D86Ee20D869112572136221e173428DD740B",
            wrappedTokenGateway: "0x60eE8b61a13c67d0191c851BEC8F0bc850160710"
        };

        const uniswapContractAddresses = {
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            pools: {
                USDC_USDT: "0xA73C628eaf6e283E26A7b1f8001CF186aa4c0E8E"
            },
            factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"
        };

        const compoundContractAddresses = {
            markets: {
                cUSDCv3: "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB"
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

        const AaveV3UsdsAdapterFactory = await ethers.getContractFactory("AaveV3UsdsAdapter", owner);
        const AaveV3UsdsAdapter = (await AaveV3UsdsAdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            daiUsdsConverter: AddressZero,
            dai: AddressZero,
            usds: AddressZero,
            aaveLendingPool: aaveContractAddresses.pool,
            aaveDataProvider: aaveContractAddresses.protocolDataProvider,
            isFullMigration: true,
            useSwapRouter02: false
        })) as AaveV3UsdsAdapter;
        await AaveV3UsdsAdapter.deployed();

        const adapters = [AaveV3UsdsAdapter.address];
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
            flashData,
            AddressZero,
            AddressZero
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
            AaveV3UsdsAdapter,
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract,
                wrappedTokenGateway
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDT: parseUnits("300", tokenDecimals.USDT)
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

            // setup the collateral and borrow positions in AaveV3
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                ETH: parseEther("0.05"), // 130 USD
                WBTC: fundingData.WBTC, // 955 USD
                USDT: fundingData.USDT // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                // supply ETH as collateral
                if (token === "ETH") {
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
                DAI: parseUnits("70", tokenDecimals.DAI), // ~70 USD
                LINK: parseUnits("15", tokenDecimals.LINK) // ~265 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    LINK: await debtTokenContracts.LINK.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.LINK,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
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
                            deadline,
                            amountOutMinimum: 1n
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
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    LINK: await debtTokenContracts.LINK.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.LINK).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.ETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
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
                aaveContractAddresses,
                aTokenContracts,
                debtTokenContracts,
                compoundContractAddresses,
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseEther("0.05"), // 130 USD
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDT: parseUnits("300", tokenDecimals.USDT)
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

            // setup the collateral and borrow positions in AaveV3
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                WETH: fundingData.WETH, // 130 USD
                WBTC: fundingData.WBTC, // 955 USD
                USDT: fundingData.USDT // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 625 USD
            const borrowAmounts = {
                USDC: parseUnits("100", tokenDecimals.USDC),
                DAI: parseUnits("70", tokenDecimals.DAI),
                LINK: parseUnits("30", tokenDecimals.LINK) // ~555 USD
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            await aTokenContracts.WBTC.approve(migratorV2.address, MaxUint256);

            // set allowance for migrator to spend cUSDCv3
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    LINK: await debtTokenContracts.LINK.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.LINK,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
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

            const flashAmount = parseUnits("555", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    ETH: await aTokenContracts.WETH.balanceOf(user.address),
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address),
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    LINK: await debtTokenContracts.LINK.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    WETH: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.USDC).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowAave.LINK).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.not.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract,
                wrappedTokenGateway
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDT: parseUnits("300", tokenDecimals.USDT)
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

            // setup the collateral and borrow positions in AaveV3
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1385 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                USDT: fundingData.USDT // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 200 USD
            const borrowAmounts = {
                DAI: parseUnits("70", tokenDecimals.DAI),
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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
                            deadline,
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
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            const flashAmount = parseUnits("200", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    ETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowAave.ETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // setup the collateral and borrow positions in AaveV3
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

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
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

            const flashAmount = parseUnits("250", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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

            logger("userBalancesAfter:", userBalancesAfter);

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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // setup the collateral and borrow positions in AaveV3
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
                DAI: parseUnits("100", tokenDecimals.DAI)
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // setup the collateral and borrow positions in AaveV3
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
                DAI: parseUnits("70", tokenDecimals.DAI),
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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // setup the collateral and borrow positions in AaveV3
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
                DAI: parseUnits("100", tokenDecimals.DAI)
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
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
                                FEE_3000,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // setup the collateral and borrow positions in AaveV3
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

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
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
                                FEE_3000,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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

            logger("userBalancesAfter:", userBalancesAfter);

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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDT: parseUnits("100", tokenDecimals.USDT)
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

            // setup the collateral and borrow positions in AaveV3
            const interestRateMode = 2; // variable
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                USDT: fundingData.USDT // 100 USD
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

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountInMaximum: 1n
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
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, flashAmount, anyValue);

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

            logger("userBalancesAfter:", userBalancesAfter);

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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
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
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

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
            await cUSDCv3Contract.allow(migratorV2.address, true);
            expect(await cUSDCv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDC,
                        amount: MaxUint256,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDC: await aTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDC).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
                cUSDCv3Contract
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                USDT: parseUnits("100", tokenDecimals.USDT)
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

            // setup the collateral and borrow positions in AaveV3
            const referralCode = 0;

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // 955 USD
                USDT: fundingData.USDT // 100 USD
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.USDT).to.be.equal(Zero);
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
                AaveV3UsdsAdapter,
                migratorV2,
                aaveV3Pool,
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
                expect(await tokenContract.balanceOf(treasuryAddress)).to.be.above(amount);

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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesBefore:", userBalancesBefore);

            const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WBTC,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            deadline,
                            amountOutMinimum: 1n
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_3000,
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

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        AaveV3UsdsAdapter.address,
                        compoundContractAddresses.markets.cUSDCv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(AaveV3UsdsAdapter.address, user.address, cUSDCv3Contract.address, Zero, Zero);

            const userBalancesAfter = {
                collateralsAave: {
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    DAI: await aTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            logger("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);
    });
});
