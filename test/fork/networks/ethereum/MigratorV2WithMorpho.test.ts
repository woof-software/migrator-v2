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
    BigNumber
} from "../../../helpers"; // Adjust the path as needed

import {
    MigratorV2,
    MorphoAdapter,
    ERC20__factory,
    IComet__factory,
    ERC20,
    MigratorV2__factory,
    Ownable__factory,
    UniswapV3PathFinder
} from "../../../../typechain-types";

import { MorphoPool__factory } from "../../types/contracts";

/**
 *  **Fork Tests: How to Run**
 *
 *  **Fill in the `.env` file** according to the provided example, specifying correct RPC URLs and fork block numbers.
 *
 *  **Running Fork Tests**
 *    - The main command to execute a fork test:
 *      ```sh
 *      npm run test-f-morpho --fork-network=ethereum
 *      ```
 *
 *  **Enabling Debug Logs**
 *    - To display additional debug logs (collateral balances and borrow positions before and after migration),
 *      add the `--debug-log=true` flag:
 *      ```sh
 *      npm run test-f-morpho --debug-log=true --fork-network=ethereum
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
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 amountInMaximum) swapParams)[]",
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 amountOutMinimum) swapParams)[]"
];

const SLIPPAGE_BUFFER_PERCENT = 115; // 15% slippage buffer

describe("MigratorV2 and MorphoAdapter contracts", function () {
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
            wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
            cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
            sDAI: "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
            USDe: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3"
        };

        const treasuryAddresses: Record<string, string> = {
            WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            DAI: "0xD1668fB5F690C59Ab4B0CAbAd0f8C1617895052B",
            USDC: "0xC8e2C09A252ff6A41F82B4762bB282fD0CEA2280",
            USDT: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            USDS: "0x1AB4973a48dc892Cd9971ECE8e01DcC7688f8F23",
            WETH: "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
            wstETH: "0xacB7027f271B03B502D65fEBa617a0d817D62b8e",
            LINK: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
            cbBTC: "0x698C1f4c8db11629fDC913F54A6dC44a9166F187",
            sDAI: "0x15a8B2ceA2D8f48c150f2EC7be07808c54355Bc7",
            USDe: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497"
        };

        const morphoContractAddresses: Record<string, string> = {
            pool: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
        };

        const morphoMarketsData: Record<string, { id: string; loanToken: string }> = {
            WBTC: {
                id: "0xa921ef34e2fc7a27ccc50ae7e4b154e16c9799d3387076c421423ef52ac4df99",
                loanToken: "USDT"
            },
            // wstETH: {
            //     id: "0x82076a47f01513bb21a227c64f6c358c6748fe007155dac9f56d5524b2f1f512",
            //     loanToken: "WBTC"
            // },
            wstETH: {
                id: "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc",
                loanToken: "USDC"
            },
            USDe: {
                id: "0x8e6aeb10c401de3279ac79b4b2ea15fc94b7d9cfc098d6c2a1ff7b2b26d9d02c",
                loanToken: "DAI"
            },
            LINK: {
                id: "0x9c765f69d8a8e40d2174824bc5107d05d7f0d0f81181048c9403262aeb1ab457",
                loanToken: "USDC"
            },
            cbBTC: {
                id: "0x935faae97f5784dc97fba3c6ec072186ad9dbbf16368431c38f6a8b7fc3ec9a3",
                loanToken: "WETH"
            } //,
            // WETH: {
            //     id: "0xf9acc677910cc17f650416a22e2a14d5da7ccb9626db18f1bf94efe64f92b372",
            //     loanToken: "USDC"
            // }
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

        const MorphoAdapterFactory = await ethers.getContractFactory("MorphoUsdsAdapter", owner);
        const morphoAdapter = (await MorphoAdapterFactory.connect(owner).deploy({
            uniswapRouter: uniswapContractAddresses.router,
            daiUsdsConverter: daiUsdsAddress,
            dai: tokenAddresses.DAI,
            usds: tokenAddresses.USDS,
            wrappedNativeToken: tokenAddresses.WETH,
            morphoLendingPool: morphoContractAddresses.pool,
            isFullMigration: true
        })) as MorphoAdapter;
        await morphoAdapter.deployed();

        const UniswapV3PathFinder = await ethers.getContractFactory("UniswapV3PathFinder");
        const uniswapV3PathFinder = (await UniswapV3PathFinder.connect(user).deploy(
            uniswapContractAddresses.factory,
            uniswapContractAddresses.quoterV2,
            tokenAddresses.DAI,
            tokenAddresses.USDS
        )) as UniswapV3PathFinder;

        await uniswapV3PathFinder.deployed();

        const adapters = [morphoAdapter.address];
        const comets = [compoundContractAddresses.markets.cUSDCv3, compoundContractAddresses.markets.cUSDSv3];

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: uniswapContractAddresses.pools.USDC_USDT, // Uniswap V3 pool USDC / USDT
                baseToken: tokenAddresses.USDC, // USDC
                isToken0: true
            },
            // {
            //     liquidityPool: uniswapContractAddresses.pools.DAI_USDS, // Uniswap V3 pool DAI / USDS
            //     baseToken: tokenAddresses.USDS, // USDS
            //     isToken0: false
            // }
            {
                liquidityPool: uniswapContractAddresses.pools.DAI_USDS, // Uniswap V3 pool DAI / USDS
                baseToken: tokenAddresses.DAI,
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
        const morphoPool = MorphoPool__factory.connect(morphoContractAddresses.pool, user);

        const cUSDCv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDCv3, user);
        const cUSDSv3Contract = IComet__factory.connect(compoundContractAddresses.markets.cUSDSv3, user);

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
            daiUsdsAddress,
            morphoAdapter,
            migratorV2,
            morphoPool,
            cUSDCv3Contract,
            cUSDSv3Contract,
            morphoMarketsData,
            uniswapV3PathFinder
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
                morphoMarketsData,
                owner
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                USDe: parseUnits("1300", tokenDecimals.USDe), // ~1300 USD
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 1350 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                USDe: fundingData.USDe, // ~1300 USD
                LINK: fundingData.LINK // ~530 USD
            };

            // total borrow amount equivalent to 435 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDT: parseUnits("265", tokenDecimals.USDT), // ~265 USD
                DAI: parseUnits("70", tokenDecimals.DAI), // ~70 USD
                USDC: parseUnits("100", tokenDecimals.USDC) // ~100 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                // Setup the borrows to be migrated
                borrows: [
                    {
                        marketId: morphoMarketsData.WBTC.id, // USDT loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        marketId: morphoMarketsData.USDe.id, // DAI loan token
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.LINK.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                // Setup the collaterals to be migrated
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.USDe.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDe, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
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
            console.log("STARTING TEST");

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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.DAI).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.USDe).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
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
                USDe: parseUnits("1300", tokenDecimals.USDe), // ~1300 USD
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 1350 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                USDe: fundingData.USDe, // ~1300 USD
                LINK: fundingData.LINK // ~530 USD
            };

            // total borrow amount equivalent to 435 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDT: parseUnits("265", tokenDecimals.USDT), // ~265 USD
                DAI: parseUnits("70", tokenDecimals.DAI), // ~70 USD
                USDC: parseUnits("100", tokenDecimals.USDC) // ~100 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.WBTC.id, // USDT loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares,
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.DAI).to.be.not.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.not.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.USDe).to.be.not.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.not.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as WBTC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
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
                USDe: parseUnits("1300", tokenDecimals.USDe), // ~1300 USD
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

            // total supply amount equivalent to 2255 USD
            const supplyAmounts = {
                USDe: fundingData.USDe, // ~1300 USD
                WBTC: fundingData.WBTC // ~ 955 USD
            };

            // total borrow amount equivalent to 335 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDT: parseUnits("265", tokenDecimals.USDT), // ~265 USD
                DAI: parseUnits("70", tokenDecimals.DAI) // ~70 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                // Setup the borrows to be migrated
                borrows: [
                    {
                        marketId: morphoMarketsData.WBTC.id, // USDT loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDT, 20),
                                FEE_3000,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("265", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    },
                    {
                        marketId: morphoMarketsData.USDe.id, // DAI loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                // Setup the collaterals to be migrated
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.USDe.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDe, 20),
                                FEE_100,
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

            const flashAmount = parseUnits("335", tokenDecimals.USDC).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDT: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).borrowShares,
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDT).to.be.equal(Zero);
            expect(userBalancesAfter.borrowMorpho.DAI).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.USDe).to.be.equal(Zero);
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
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 530 USD
            const supplyAmounts = {
                LINK: fundingData.LINK // ~530 USD
            };

            // total borrow amount equivalent to 135 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("135", tokenDecimals.USDC) // ~135 USD
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
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.LINK.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
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
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as LINK
            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.above(userBalancesBefore.collateralsComet.LINK);
        }).timeout(0);

        it("Scn.#5: migration of all collaterals | one collateral and one borrow tokens | only swaps (borrow pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbBTC.id, // USDT loan token
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
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

            log("userBalancesAfter:", userBalancesAfter);

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
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                cbBTC: parseUnits("0.01", tokenDecimals.WBTC) // ~ 955 USD
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

            // total supply amount equivalent to 1055 USD
            const supplyAmounts = {
                cbBTC: fundingData.cbBTC // 955 USD
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

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.cbBTC.id, // USDT loan token
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.cbBTC.id,
                        assetsAmount: MaxUint256,
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

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.WETH).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.cbBTC).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.cbBTC).to.be.equal(userBalancesBefore.collateralsComet.cbBTC);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#7: migration of all collaterals | one collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // Setup the collateral and borrow positions in Morpho
            // total supply amount equivalent to 530 USD
            const supplyAmounts = {
                LINK: fundingData.LINK // ~530 USD
            };

            // total borrow amount equivalent to 135 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("135", tokenDecimals.USDC) // ~135 USD
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
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.LINK.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
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
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#8: migration of all collaterals | tow collateral and one borrow tokens | only swaps (collateral pos.)", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // total supply amount equivalent to 1485 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                LINK: fundingData.LINK // ~530 USD
            };
            // total borrow amount equivalent to 115 USD
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("100", tokenDecimals.USDC) // ~100 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.LINK.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountInMaximum: 0
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#9: migration of all collaterals | two collateral without borrow tokens | without swaps", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                cUSDCv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // total supply amount equivalent to 1485 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                LINK: fundingData.LINK // ~530 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: "0x",
                            amountOutMinimum: 0
                        }
                    },
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as WBTC and LINK
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.above(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.above(userBalancesBefore.collateralsComet.LINK);

            expect(userBalancesAfter.collateralsComet.USDC).to.be.equal(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#10: migration of all collaterals | two collateral without borrow tokens | only swaps (single-hop route)", async function () {
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
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // total supply amount equivalent to 1485 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                LINK: fundingData.LINK // ~530 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
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
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
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
                WBTC: parseUnits("0.01", tokenDecimals.WBTC), // ~ 955 USD
                LINK: parseUnits("30", tokenDecimals.LINK) // ~530 USD
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

            // total supply amount equivalent to 1485 USD
            const supplyAmounts = {
                WBTC: fundingData.WBTC, // ~955 USD
                LINK: fundingData.LINK // ~530 USD
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [],
                collaterals: [
                    {
                        marketId: morphoMarketsData.WBTC.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.WBTC, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20)
                            ]),
                            amountOutMinimum: 0
                        }
                    },
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.LINK, 20),
                                FEE_500,
                                ethers.utils.hexZeroPad(tokenAddresses.WETH, 20),
                                FEE_100,
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
                    WBTC: (await morphoPool.position(morphoMarketsData.WBTC.id, user.address)).collateral,
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                collateralsComet: {
                    USDC: await cUSDCv3Contract.balanceOf(user.address),
                    WBTC: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.WBTC),
                    LINK: await cUSDCv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralsMorpho.WBTC).to.be.equal(Zero);
            expect(userBalancesAfter.collateralsMorpho.LINK).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.WBTC).to.be.equal(userBalancesBefore.collateralsComet.WBTC);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
            expect(userBalancesAfter.collateralsComet.USDC).to.be.above(userBalancesBefore.collateralsComet.USDC);
        }).timeout(0);

        it("Scn.#12: migration of all collaterals | one collateral and one borrow tokens | conversion and swap ", async function () {
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
                cUSDSv3Contract,
                morphoMarketsData
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                USDe: parseUnits("1300", tokenDecimals.USDe) // ~1300 USD
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

            // total supply amount equivalent to 1300 USD
            const supplyAmounts = {
                USDe: fundingData.USDe // ~1300 USD
            };
            // total borrow amount equivalent to 350 USD
            const borrowAmounts: Record<string, BigNumber> = {
                DAI: parseUnits("350", tokenDecimals.DAI) // ~350 USD
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

            // set allowance for migrator to spend cUSDSv3
            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral
                },
                borrowMorpho: {
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares
                },
                collateralComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.USDe.id, // DAI loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDS, 20),
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20)
                            ]),
                            amountInMaximum: parseUnits("70", tokenDecimals.USDS).mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.USDe.id,
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: ethers.utils.concat([
                                ethers.utils.hexZeroPad(tokenAddresses.USDe, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.USDC, 20),
                                FEE_100,
                                ethers.utils.hexZeroPad(tokenAddresses.DAI, 20)
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

            const flashAmount = parseUnits("350", tokenDecimals.USDS).mul(SLIPPAGE_BUFFER_PERCENT).div(100);

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    USDe: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).collateral
                },
                borrowMorpho: {
                    DAI: (await morphoPool.position(morphoMarketsData.USDe.id, user.address)).borrowShares
                },
                collateralComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // collateral should be migrated
            expect(userBalancesAfter.collateralMorpho.USDe).to.be.equal(Zero);
            // borrow should be closed
            expect(userBalancesAfter.borrowMorpho.DAI).to.be.equal(Zero);
            // collaterals from Aave should be migrated to Comet as USDS
            expect(userBalancesAfter.collateralComet.USDS).to.be.above(userBalancesBefore.collateralComet.USDS);
        }).timeout(0);

        //  --- UPDATE ---

        it("Scn.#13: uniswapV3PathFinder and migratorV2 contracts | ", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                morphoMarketsData,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                uniswapContractAddresses,
                cUSDSv3Contract,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                LINK: parseUnits("0.98", tokenDecimals.LINK) // 0.098 LINK
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

            // total supply amount
            const supplyAmounts = {
                LINK: fundingData.LINK
            };
            // total borrow amount
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("10.538137", tokenDecimals.USDC) // 10.538137 USD
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

            // set allowance for migrator to spend cUSDSv3
            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    LINK: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const borrowSwapData = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.DAI,
                    tokenOut: tokenAddresses.USDC,
                    connectors: [tokenAddresses.wstETH, tokenAddresses.USDC, tokenAddresses.WETH],
                    amountIn: Zero,
                    amountOut: borrowAmounts.USDC,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            console.log("borrowSwapData:", borrowSwapData);

            const collateralSwapData = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.LINK,
                    tokenOut: tokenAddresses.DAI,
                    connectors: [tokenAddresses.wstETH, tokenAddresses.USDC, tokenAddresses.WETH],
                    amountIn: supplyAmounts.LINK,
                    amountOut: Zero,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            console.log("collateralSwapData:", collateralSwapData);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.LINK.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: borrowSwapData.path,
                            amountInMaximum: borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.LINK.id,
                        assetsAmount: MaxUint256,
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

            console.log("flashAmount:", flashAmount.toString());

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    LINK: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.LINK.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    LINK: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.LINK)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralMorpho.LINK).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as USDC
            expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            expect(userBalancesAfter.collateralsComet.LINK).to.be.equal(userBalancesBefore.collateralsComet.LINK);
            // should be borrowed USDS
            expect(userBalancesBefore.borrowComet.USDS).to.be.equal(Zero);
            expect(userBalancesAfter.borrowComet.USDS).to.be.equal(userBalancesBefore.borrowComet.USDS);
        }).timeout(0);

        it("Scn.#14: uniswapV3PathFinder and migratorV2 contracts | ", async function () {
            const {
                user,
                treasuryAddresses,
                tokenAddresses,
                tokenContracts,
                tokenDecimals,
                morphoContractAddresses,
                morphoMarketsData,
                compoundContractAddresses,
                morphoAdapter,
                migratorV2,
                morphoPool,
                uniswapContractAddresses,
                cUSDSv3Contract,
                uniswapV3PathFinder
            } = await loadFixture(setupEnv);

            // simulation of the vault contract work
            const fundingData = {
                wstETH: parseUnits("0.006", tokenDecimals.wstETH)
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

            // total supply amount
            const supplyAmounts = {
                wstETH: fundingData.wstETH
            };
            // total borrow amount
            const borrowAmounts: Record<string, BigNumber> = {
                USDC: parseUnits("10.538137", tokenDecimals.USDC) // 10.538137 USD
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

            // set allowance for migrator to spend cUSDSv3
            await cUSDSv3Contract.allow(migratorV2.address, true);
            expect(await cUSDSv3Contract.isAllowed(user.address, migratorV2.address)).to.be.true;

            const userBalancesBefore = {
                collateralMorpho: {
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    wstETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesBefore:", userBalancesBefore);

            const borrowSwapData = await uniswapV3PathFinder.callStatic.getBestMultiSwapPath(
                {
                    tokenIn: tokenAddresses.DAI,
                    tokenOut: tokenAddresses.USDC,
                    connectors: [tokenAddresses.USDT, tokenAddresses.USDC, tokenAddresses.WETH],
                    amountIn: Zero,
                    amountOut: borrowAmounts.USDC,
                    excludedPool: uniswapContractAddresses.pools.DAI_USDS,
                    maxGasEstimate: 500000
                },
                { gasLimit: 30000000 }
            );

            console.log("borrowSwapData:", borrowSwapData);

            const position = {
                borrows: [
                    {
                        marketId: morphoMarketsData.wstETH.id, // USDC loan token
                        assetsAmount: MaxUint256,
                        swapParams: {
                            path: borrowSwapData.path,
                            amountInMaximum: borrowSwapData.estimatedAmount.mul(SLIPPAGE_BUFFER_PERCENT).div(100)
                        }
                    }
                ],
                collaterals: [
                    {
                        marketId: morphoMarketsData.wstETH.id,
                        assetsAmount: MaxUint256,
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

            console.log("flashAmount:", flashAmount.toString());

            // Approve migration
            await morphoPool.connect(user).setAuthorization(migratorV2.address, true);

            await expect(
                migratorV2
                    .connect(user)
                    .migrate(
                        morphoAdapter.address,
                        compoundContractAddresses.markets.cUSDSv3,
                        migrationData,
                        flashAmount
                    )
            )
                .to.emit(migratorV2, "MigrationExecuted")
                .withArgs(morphoAdapter.address, user.address, cUSDSv3Contract.address, flashAmount, anyValue);

            const userBalancesAfter = {
                collateralMorpho: {
                    wstETH: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).collateral
                },
                borrowMorpho: {
                    USDC: (await morphoPool.position(morphoMarketsData.wstETH.id, user.address)).borrowShares
                },
                collateralsComet: {
                    USDS: await cUSDSv3Contract.balanceOf(user.address),
                    wstETH: await cUSDSv3Contract.collateralBalanceOf(user.address, tokenAddresses.wstETH)
                },
                borrowComet: {
                    USDS: await cUSDSv3Contract.borrowBalanceOf(user.address)
                }
            };

            log("userBalancesAfter:", userBalancesAfter);

            // all borrows should be closed
            expect(userBalancesAfter.borrowMorpho.USDC).to.be.equal(Zero);
            //all collaterals should be migrated
            expect(userBalancesAfter.collateralMorpho.wstETH).to.be.equal(Zero);
            // all collaterals from Aave should be migrated to Comet as wstETH
            expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            expect(userBalancesAfter.collateralsComet.wstETH).to.be.above(userBalancesBefore.collateralsComet.wstETH);
            // should be borrowed USDS
            expect(userBalancesBefore.borrowComet.USDS).to.be.equal(Zero);
            expect(userBalancesAfter.borrowComet.USDS).to.be.above(userBalancesBefore.borrowComet.USDS);
        }).timeout(0);
    });
});
