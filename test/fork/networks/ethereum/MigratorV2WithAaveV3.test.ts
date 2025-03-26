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
    log,
    formatUnits,
    AddressZero,
    BigNumber
} from "../../../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    AaveV3UsdsAdapter,
    ERC20__factory,
    IComet__factory,
    ERC20,
    IAToken__factory,
    IAToken,
    IDebtToken__factory,
    IDebtToken,
    UniswapV3PathFinder
} from "../../../../typechain-types";

import {
    AavePool__factory,
    WrappedTokenGatewayV3__factory,
    Quoter__factory,
    QuoterV2__factory,
    UniswapV3Factory__factory
} from "../../types/contracts";
import c from "config";

/**
 *  **Fork Tests: How to Run**
 *
 *  **Fill in the `.env` file** according to the provided example, specifying correct RPC URLs and fork block numbers.
 *
 *  **Running Fork Tests**
 *    - The main command to execute a fork test:
 *      ```sh
 *      npm run test-f-aave --fork-network=ethereum
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-aave --debug-log=true --fork-network=ethereum
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
const FEE_10000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(10000), 3); // 1%
const FEE_3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0.3%
const FEE_500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(500), 3); // 0.05%
const FEE_100 = ethers.utils.hexZeroPad(ethers.utils.hexlify(100), 3); // 0.01%

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
            WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            USDS: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
            WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
            wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
        };

        const treasuryAddresses: Record<string, string> = {
            WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            DAI: "0xD1668fB5F690C59Ab4B0CAbAd0f8C1617895052B",
            USDC: "0xC8e2C09A252ff6A41F82B4762bB282fD0CEA2280",
            USDT: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            USDS: "0x1AB4973a48dc892Cd9971ECE8e01DcC7688f8F23",
            WETH: "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
            LINK: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            wstETH: "0xC329400492c6ff2438472D4651Ad17389fCb843a",
            cbBTC: "0x698C1f4c8db11629fDC913F54A6dC44a9166F187"
        };

        const aaveContractAddresses = {
            aToken: {
                WBTC: "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8",
                DAI: "0x018008bfb33d285247A21d44E50697654f754e63",
                USDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
                USDT: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a",
                USDS: "0x32a6268f9Ba3642Dda7892aDd74f1D34469A4259",
                WETH: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8",
                LINK: "0x5E8C8A7243651DB1384C0dDfDbE39761E8e7E51a"
            },
            variableDebtToken: {
                WBTC: "0x40aAbEf1aa8f0eEc637E0E7d92fbfFB2F26A8b7B",
                DAI: "0xcF8d0c70c850859266f5C338b38F9D663181C314",
                USDC: "0x72E95b8931767C79bA4EeE721354d6E99a61D004",
                USDT: "0x6df1C1E379bC5a00a7b4C6e67A203333772f45A8",
                USDS: "0x490E0E6255bF65b43E2e02F7acB783c5e04572Ff",
                WETH: "0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE",
                LINK: "0x4228F8895C7dDA20227F6a5c6751b8Ebf19a6ba8"
            },
            pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
            protocolDataProvider: "0x41393e5e337606dc3821075Af65AeE84D7688CBD",
            wrappedTokenGateway: "0xA434D495249abE33E031Fe71a969B81f3c07950D"
        };

        // convertor Dai to Usds address
        const daiUsdsAddress = "0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A";

        const uniswapContractAddresses = {
            router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            pools: {
                USDC_USDT: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6",
                DAI_USDS: "0xe9F1E2EF814f5686C30ce6fb7103d0F780836C67"
            },
            factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
            quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
            quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"
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
                baseToken: tokenAddresses.DAI, // DAI
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

        const UniswapV3PathFinder = await ethers.getContractFactory("UniswapV3PathFinder");
        const uniswapV3PathFinder = (await UniswapV3PathFinder.connect(user).deploy(
            uniswapContractAddresses.factory,
            uniswapContractAddresses.quoterV2,
            tokenAddresses.DAI,
            tokenAddresses.USDS
        )) as UniswapV3PathFinder;

        await uniswapV3PathFinder.deployed();

        // Connecting to all necessary contracts for testing
        const aaveV3Pool = AavePool__factory.connect(aaveContractAddresses.pool, user);

        const wrappedTokenGateway = WrappedTokenGatewayV3__factory.connect(
            aaveContractAddresses.wrappedTokenGateway,
            user
        );

        const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);
        const cUSDSv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDSv3, user);

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
            daiUsdsAddress,
            aaveV3Adapter,
            migratorV2,
            aaveV3Pool,
            wrappedTokenGateway,
            cUSDCv3Contract,
            cUSDSv3Contract,
            uniswapV3PathFinder
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
                uniswapContractAddresses,
                compoundContractAddresses,
                aaveV3Adapter,
                migratorV2,
                aaveV3Pool,
                wrappedTokenGateway,
                cUSDCv3Contract
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
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
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
                        aToken: aaveContractAddresses.aToken.USDT,
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

            log("userBalancesAfter:", userBalancesAfter);

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
                WETH: parseEther("0.05"), // 130 USD
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.LINK,
                        amount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
                                FEE_3000,
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

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
                migratorV2,
                aaveV3Pool,
                wrappedTokenGateway,
                cUSDCv3Contract
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

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                // supply ETH as collateral
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
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
                        debtToken: aaveContractAddresses.variableDebtToken.WETH,
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
                        aToken: aaveContractAddresses.aToken.USDT,
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

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address),
                    USDC: await debtTokenContracts.USDC.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
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
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
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
                        aToken: aaveContractAddresses.aToken.USDT,
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
                collateralsAave: {
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
                aaveV3Adapter,
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

            log("userBalancesBefore:", userBalancesBefore);

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
                            amountOutMinimum: 0
                        }
                    },
                    {
                        aToken: aaveContractAddresses.aToken.USDT,
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address),
                    USDT: await aTokenContracts.USDT.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

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
                aaveV3Adapter,
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

            log("userBalancesBefore:", userBalancesBefore);

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
                            amountOutMinimum: 0
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
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#13: migration of all collaterals | one collateral without borrow tokens | only conversion", async function () {
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
                cUSDSv3Contract,
                uniswapContractAddresses,
                uniswapV3PathFinder
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
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
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

            const swapData = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.DAI,
                    tokenOut: tokenAddresses.USDS,
                    amountIn: userBalancesBefore.collateralsAave.DAI,
                    amountOut: Zero,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );
            const amountOutMinimum = BigNumber.from(swapData.estimatedAmount).mul(99).div(100);
            const position = {
                borrows: [],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: swapData.path,
                            amountOutMinimum: amountOutMinimum
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
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDSv3Contract.address, Zero, Zero);

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

        it("Scn.#14: migration of all collaterals | one collateral without borrow tokens | only conversion", async function () {
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
                cUSDSv3Contract,
                uniswapContractAddresses,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                USDS: parseUnits("300", tokenDecimals.USDS)
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

            // total supply amount equivalent to 300 USD
            const supplyAmounts = {
                USDS: fundingData.USDS // 300 USD
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            // total borrow amount equivalent to 50 USD
            const borrowAmounts = {
                DAI: parseUnits("50", tokenDecimals.DAI)
            };

            for (const [token, amount] of Object.entries(borrowAmounts)) {
                await aaveV3Pool.borrow(tokenAddresses[token], amount, interestRateMode, referralCode, user.address);
            }

            // Approve migration
            for (const [symbol] of Object.entries(supplyAmounts)) {
                await aTokenContracts[symbol].approve(migratorV2.address, MaxUint256);
            }

            // set allowance for migrator to spend cUSDCv3
            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralAave: {
                    USDS: await aTokenContracts.USDS.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const collateralSwapData = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.USDS,
                    tokenOut: tokenAddresses.DAI,
                    amountIn: userBalancesBefore.collateralAave.USDS,
                    amountOut: Zero,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.DAI,
                        amount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.USDS,
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

            const flashAmount = parseUnits("50", tokenDecimals.DAI).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralAave: {
                    USDS: await aTokenContracts.USDS.balanceOf(user.address)
                },
                borrowAave: {
                    DAI: await debtTokenContracts.DAI.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralAave.USDS).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDS
            expect(userBalancesAfter.collateralsComet.USDS).to.be.not.equal(userBalancesBefore.collateralsComet.USDS);
        }).timeout(0);

        // -- UPD

        it("Scn.#15: uniswapV3PathFinder and migratorV2 contracts | ", async function () {
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
                uniswapContractAddresses,
                cUSDCv3Contract,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC)
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

            const supplyAmounts = {
                WBTC: fundingData.WBTC
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            const borrowAmounts = {
                USDT: parseUnits("300", tokenDecimals.USDT)
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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDT: await debtTokenContracts.USDT.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const borrowSwapData = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.USDC,
                    tokenOut: tokenAddresses.USDT,
                    amountIn: Zero,
                    amountOut: userBalancesBefore.borrowAave.USDT,
                    excludedPool: uniswapContractAddresses.pools.USDC_USDT,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            // console.log("amountOut:", formatUnits(userBalancesBefore.borrowAave.USDT, tokenDecimals.USDT));
            // console.log("amountIn:", formatUnits(swapData.estimatedAmount, tokenDecimals.USDC));
            // console.log("swapData:", swapData);

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.USDT,
                        amount: MaxUint256,
                        swapParams: {
                            path: borrowSwapData.path,
                            amountInMaximum: borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100)
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

            const flashAmount = borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    WBTC: await aTokenContracts.WBTC.balanceOf(user.address)
                },
                borrowAave: {
                    USDT: await debtTokenContracts.USDT.balanceOf(user.address)
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.USDT).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WBTC).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.not.equal(userBalancesBefore.collateralsComet.WBTC);
        }).timeout(0);

        it("Scn.#16: uniswapV3PathFinder and migratorV2 contracts | ", async function () {
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
                uniswapContractAddresses,
                cUSDSv3Contract,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseUnits("0.2", tokenDecimals.WETH) // ~ 200 USD
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

            const supplyAmounts = {
                WETH: fundingData.WETH // 0.02 ETH
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            const borrowAmounts = {
                WETH: parseUnits("0.1", tokenDecimals.WETH)
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

            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address)
                },
                borrowAave: {
                    WETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    WETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const borrowSwapData = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.DAI,
                    tokenOut: tokenAddresses.WETH,
                    amountIn: Zero,
                    amountOut: userBalancesBefore.borrowAave.WETH,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: borrowSwapData.path,
                            amountInMaximum: borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WETH,
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

            const flashAmount = borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address)
                },
                borrowAave: {
                    WETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    WETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.WETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            expect(userBalancesAfter.collateralsComet.WETH).to.be.above(userBalancesBefore.collateralsComet.WETH);
            // should be borrowed USDS
            expect(userBalancesBefore.borrowComet.USDS).to.be.equal(Zero);
            expect(userBalancesAfter.borrowComet.USDS).to.be.above(userBalancesBefore.borrowComet.USDS);
        }).timeout(0);

        it("Scn.#17: uniswapV3PathFinder and migratorV2 contracts | ", async function () {
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
                uniswapContractAddresses,
                cUSDSv3Contract,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WETH: parseUnits("0.2", tokenDecimals.WETH) // ~ 200 USD
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

            const supplyAmounts = {
                WETH: fundingData.WETH // 0.02 ETH
            };

            for (const [token, amount] of Object.entries(supplyAmounts)) {
                await tokenContracts[token].approve(aaveV3Pool.address, amount);
                await aaveV3Pool.supply(tokenAddresses[token], amount, user.address, referralCode);
            }

            const borrowAmounts = {
                WETH: parseUnits("0.1", tokenDecimals.WETH)
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

            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address)
                },
                borrowAave: {
                    WETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    WETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const borrowSwapData = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.DAI,
                    tokenOut: tokenAddresses.WETH,
                    amountIn: Zero,
                    amountOut: userBalancesBefore.borrowAave.WETH,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            const collateralSwapData = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.WETH,
                    tokenOut: tokenAddresses.DAI,
                    connectors: [tokenAddresses.USDT, tokenAddresses.USDC, tokenAddresses.WETH],
                    amountIn: userBalancesBefore.collateralsAave.WETH,
                    amountOut: Zero,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            const position = {
                borrows: [
                    {
                        debtToken: aaveContractAddresses.variableDebtToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: borrowSwapData.path,
                            amountInMaximum: borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        aToken: aaveContractAddresses.aToken.WETH,
                        amount: MaxUint256,
                        swapParams: {
                            path: collateralSwapData.path,
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

            const flashAmount = borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        aaveV3Adapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(aaveV3Adapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralsAave: {
                    WETH: await aTokenContracts.WETH.balanceOf(user.address)
                },
                borrowAave: {
                    WETH: await debtTokenContracts.WETH.balanceOf(user.address)
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    WETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.WETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowAave.WETH).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
            // should be borrowed USDS
            expect(userBalancesBefore.borrowComet.USDS).to.be.equal(Zero);
            expect(userBalancesAfter.borrowComet.USDS).to.be.equal(userBalancesBefore.borrowComet.USDS);
        }).timeout(0);

/// --- DEV 

        it("Scn.#00: uniswapV3PathFinder | USDS to DAI", async function () {
            const { tokenAddresses, tokenDecimals, migratorV2, user, uniswapContractAddresses, uniswapV3PathFinder } =
                await loadFixture(setupEnv);

            const tokenIn = tokenAddresses.USDS;
            const tokenOut = tokenAddresses.DAI;
            const amountIn = parseUnits("150", tokenDecimals.DAI);

            const maxGasEstimate = BigNumber.from(500000);

            const singlePathExpectIn = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: Zero,
                    amountOut: amountIn,
                    excludedPool: AddressZero,
                    maxGasEstimate
                },
                { gasLimit: 30000000 }
            );

            console.log("^^singlePathExpectIn:", singlePathExpectIn);
            console.log("^^bestAmountOut:", formatUnits(singlePathExpectIn.estimatedAmount, tokenDecimals.DAI));
        }).timeout(0);

        it("Scn.#01: uniswapV3PathFinder | get path for WBTC to LINK | connector: WETH, USDC, USDT", async function () {
            const { tokenAddresses, tokenDecimals, migratorV2, user, uniswapContractAddresses, uniswapV3PathFinder } =
                await loadFixture(setupEnv);

            const amountIn = parseUnits("0.15", tokenDecimals.WBTC); // 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599
            const amountOut = parseUnits("12548.45", tokenDecimals.USDT);

            const maxGasEstimate = BigNumber.from(500000);

            const singlePathExpectIn = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.WBTC,
                    tokenOut: tokenAddresses.USDT,
                    amountIn: amountIn,
                    amountOut: Zero,
                    excludedPool: AddressZero,
                    maxGasEstimate
                },
                { gasLimit: 30000000 }
            );

            console.log("^^singlePathExpectIn:", singlePathExpectIn);
            console.log("^^bestAmountOut:", formatUnits(singlePathExpectIn.estimatedAmount, tokenDecimals.USDT)); // 0.15087684

            const singlePathExpectOut = await uniswapV3PathFinder.callStatic.getBestSingleSwapPath(
                {
                    tokenIn: tokenAddresses.WBTC,
                    tokenOut: tokenAddresses.USDT,
                    amountIn: Zero,
                    amountOut: amountOut,
                    excludedPool: AddressZero,
                    maxGasEstimate
                },
                { gasLimit: 30000000 }
            );

            console.log("^^singlePathExpectOut:", singlePathExpectOut);
            console.log("^^bestAmountIn:", formatUnits(singlePathExpectOut.estimatedAmount, tokenDecimals.WBTC)); // 14287.941962

            const multiPathExpectIn = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.WBTC,
                    tokenOut: tokenAddresses.USDT,
                    connectors: [tokenAddresses.WETH],
                    amountIn: amountIn,
                    amountOut: Zero,
                    excludedPool: AddressZero,
                    maxGasEstimate
                },
                { gasLimit: 30000000 }
            );

            console.log("**multiPathExpectIn:", multiPathExpectIn);
            console.log("**bestAmountOut:", formatUnits(multiPathExpectIn.estimatedAmount, tokenDecimals.USDT)); // 14287.941962

            const multiPathExpectOut = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.WBTC,
                    // tokenOut: tokenAddresses.WETH,
                    tokenOut: tokenAddresses.USDT,
                    connectors: [tokenAddresses.WETH],
                    amountIn: Zero,
                    amountOut: amountOut,
                    excludedPool: AddressZero,
                    maxGasEstimate
                },
                { gasLimit: 30000000 }
            );

            console.log("^^multiPathExpectOut:", multiPathExpectOut);
            console.log("^^bestAmountIn:", formatUnits(multiPathExpectOut.estimatedAmount, tokenDecimals.WBTC)); // 0.15087684

            console.log("\n---------------------\n");

            const quoterV2 = QuoterV2__factory.connect(uniswapContractAddresses.quoterV2, user);
            const factory = UniswapV3Factory__factory.connect(uniswapContractAddresses.factory, user);

            // console.log("Poll_1:", await factory.getPool(tokenAddresses.WETH, tokenAddresses.USDC, 3000));

            const tokenIn = tokenAddresses.WBTC;
            const tokenOut = tokenAddresses.USDT;

            // const amountIn_ = parseUnits("0.5", tokenDecimals.WBTC);
            // const amountOut_ = parseUnits("2", tokenDecimals.WETH);

            console.log("Poll_2:", await factory.getPool(tokenIn, tokenOut, 500));

            const pathIn = ethers.utils.concat([
                ethers.utils.hexZeroPad(tokenIn, 20),
                // FEE_500,
                // ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
                FEE_500,
                ethers.utils.hexZeroPad(tokenOut, 20)
            ]);

            const pathOut = ethers.utils.concat([
                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                FEE_500,
                ethers.utils.hexZeroPad(tokenOut, 20)
                // ethers.utils.hexZeroPad(tokenIn, 20)
            ]);

            // 0x2260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb8514910771af9ca656af840dff83e8264ecf986ca
            // 0x2260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4514910771af9ca656af840dff83e8264ecf986ca
            // console.log("Path:", ethers.utils.hexlify(path));
            // console.log("---Path:", path);

            // const quote = await quoter.callStatic.quoteExactInput(path, amountIn); // ~ 955 USD
            // const quoteV2 = await quoterV2.callStatic.quoteExactInput("0x2260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb8514910771af9ca656af840dff83e8264ecf986ca", amountIn); // ~ 955 USD

            const quoteIn = await quoterV2.callStatic.quoteExactInput(pathIn, amountIn);
            // // const quoteIn = await quoterV2.callStatic.quoteExactInput(
            // //     "0x2260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4dac17f958d2ee523a2206206994597c13d831ec7000064c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            // //     amountIn
            // // );
            console.log("pathIn - ", ethers.utils.hexlify(pathIn));
            console.log("quoteIn:amountIn - ", formatUnits(quoteIn.amountOut, tokenDecimals.USDT));

            // const quoteOut = await quoterV2.callStatic.quoteExactOutput(pathOut, amountOut);
            const quoteOut = await quoterV2.callStatic.quoteExactOutput(
                "0xdac17f958d2ee523a2206206994597c13d831ec7002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb82260fac5e5542a773aa44fbcfedf7c193bc2c599",
                amountOut
            );
            console.log("pathOut - ", ethers.utils.hexlify(pathOut));
            console.log("QuoteOut:amountOut - ", formatUnits(quoteOut.amountIn, tokenDecimals.WBTC));
        }).timeout(0);

        // it.skip(
        //     "Scn.#0: uniswapV3PathFinder | get path for WBTC to LINK | connector: WETH, USDC, USDT",
        //     async function () {
        //         const {
        //             user,
        //             treasuryAddresses,
        //             tokenAddresses,
        //             tokenContracts,
        //             tokenDecimals,
        //             aaveContractAddresses,
        //             aTokenContracts,
        //             debtTokenContracts,
        //             uniswapContractAddresses,
        //             aaveV3Adapter,
        //             migratorV2,
        //             aaveV3Pool,
        //             wrappedTokenGateway, // 3652940205146178521, 52268054414917721654
        //             cUSDCv3Contract,
        //             pathFinder
        //         } = await loadFixture(setupEnv);

        //         // const testPath = ethers.utils.concat([
        //         //     ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
        //         //     FEE_500,
        //         //     ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
        //         //     FEE_100,
        //         //     ethers.utils.hexZeroPad(tokenAddresses.LINK, 20)
        //         // ]);

        //         const amountIn = parseUnits("0.01", tokenDecimals.WBTC);
        //         const maxGasEstimate = 208100000000000;

        //         const path = await pathFinder.callStatic.getBestSwapPath(
        //             // const path = await pathFinder.getBestSwapPath(
        //             tokenAddresses.WBTC,
        //             tokenAddresses.LINK,
        //             [tokenAddresses.WETH],
        //             // [tokenAddresses.WETH], // 52268054414917721654 // 3652940205146178521
        //             amountIn,
        //             // ["0x618004783d422DfB792D07D742549D5A24648dF2"], // Uniswap V3 pools: WBTC / LINK 0.3% fee
        //             [
        //                 "0x618004783d422dfb792d07d742549d5a24648df2"
        //                 // "0xe6ff8b9a37b0fab776134636d9981aa778c4e718",
        //                 // "0x4585fe77225b41b697c938b018e2ac67ac5a20c0",
        //                 // "0xcbcdf9626bc03e24f779434178a73a0b4bad62ed",
        //                 // "0x6ab3bba2f41e7eaa262fa5a1a9b3932fa161526f"
        //             ], // Uniswap V3 pools: WBTC / LINK 0.3% fee
        //             { gasLimit: 30000000 }
        //         );

        //         console.log("path:", path);
        //     }
        // ).timeout(0);
    });
});
