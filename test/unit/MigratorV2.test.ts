import {
    loadFixture,
    ethers,
    expect,
    parseEther,
    Zero,
    AddressZero,
    BigNumber,
    HashZero,
    MaxUint256,
    logger
} from "../helpers"; // Adjust the path as needed

import type {
    MigratorV2,
    AaveV3UsdsAdapter,
    SparkUsdsAdapter,
    MorphoUsdsAdapter,
    MockAavePool,
    MockADebtToken,
    MockAToken,
    MockSparkPool,
    MockSpToken,
    MockSpDebtToken,
    MockComet,
    MockSwapRouter,
    MockUniswapV3Pool,
    MockDaiUsds,
    MockERC20,
    MockWETH9,
    MockQuoterV2,
    UniswapV3PathFinder
} from "../../typechain-types";
import { token } from "../../typechain-types/@openzeppelin/contracts";
import { mockUniswapV3PoolSol } from "../../typechain-types/contracts/mocks";
import { morpho } from "../../typechain-types/contracts/interfaces";

enum NEGATIVE_TEST {
    None,
    Reentrant,
    InvalidCallbackData,
    FakeUniswapV3Pool,
    SwapRouterNotSupported,
    DebtNotCleared,
    InvalidPool
}

const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Convert fee to 3-byte hex
const FEE_10000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(10000), 3); // 1%
const FEE_3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(3000), 3); // 0.3%
const FEE_500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(500), 3); // 0.05%
const FEE_100 = ethers.utils.hexZeroPad(ethers.utils.hexlify(100), 3); // 0.01%

const POSITION_AAVE_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(address aToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const POSITION_SPARK_ABI = [
    "tuple(address debtToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(address spToken, uint256 amount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

const POSITION_MORPHO_ABI = [
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 deadline, uint256 amountInMaximum) swapParams)[]",
    "tuple(bytes32 marketId, uint256 assetsAmount, tuple(bytes path, uint256 deadline, uint256 amountOutMinimum) swapParams)[]"
];

describe("MigratorV2", function () {
    // Setup Mocks: deploy all necessary mock contracts
    async function setupMocks() {
        const [deployer] = await ethers.getSigners();
        // Deploy mock ERC20 tokens
        // Deploy mock DAI
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockDAI = await MockERC20.deploy("Mock DAI", "DAI", parseEther("1000000"), deployer.address);
        await mockDAI.deployed();
        // Deploy mock USDS
        const mockUSDS = await MockERC20.deploy("Mock USDS", "USDS", parseEther("1000000"), deployer.address);
        await mockUSDS.deployed();
        // Deploy mock USDT
        const mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", parseEther("1000000"), deployer.address);
        await mockUSDT.deployed();

        // Deploy mock WETH
        const MockWETH = await ethers.getContractFactory("MockWETH9");
        const mockWETH = await MockWETH.deploy("Mock WETH", "WETH");
        await mockWETH.deployed();

        const tokenContracts: Record<string, MockERC20 | MockWETH9> = {
            DAI: mockDAI,
            USDS: mockUSDS,
            USDT: mockUSDT,
            WETH: mockWETH
        };

        // Deploy mock DaiUsds converter
        const MockDaiUsds = await ethers.getContractFactory("MockDaiUsds");
        const mockDaiUsds = await MockDaiUsds.deploy(mockDAI.address, mockUSDS.address);
        await mockDaiUsds.deployed();

        // Deploy mock Comet
        const MockComet = await ethers.getContractFactory("MockComet");
        const mockCometUsds = await MockComet.deploy(mockUSDS.address, mockWETH.address);
        await mockCometUsds.deployed();

        const mockCometUsdt = await MockComet.deploy(mockUSDT.address, mockWETH.address);
        await mockCometUsdt.deployed();

        // Deploy mock Aave Lending Pool with mock AToken and mock Debt Token
        // Deploy mock Aave aToken
        const MockAToken = await ethers.getContractFactory("MockAToken");
        const mockATokenWETH = await MockAToken.deploy("Mock WETH AToken", "aWETH", mockWETH.address);
        await mockATokenWETH.deployed();

        const mockATokenDAI = await MockAToken.deploy("Mock DAI AToken", "aDAI", mockDAI.address);
        await mockATokenDAI.deployed();

        const mockATokenUSDT = await MockAToken.deploy("Mock USDT AToken", "aUSDT", mockUSDT.address);
        await mockATokenUSDT.deployed();

        const mockATokenUSDS = await MockAToken.deploy("Mock USDS AToken", "aUSDS", mockUSDS.address);
        await mockATokenUSDS.deployed();

        // Deploy mock Aave aDebtToken
        const MockADebtToken = await ethers.getContractFactory("MockADebtToken");
        const mockADebtTokenDAI = await MockADebtToken.deploy("Mock DAI ADebtToken", "aDebtDAI", mockDAI.address);
        await mockADebtTokenDAI.deployed();

        const mockADebtTokenUSDS = await MockADebtToken.deploy("Mock USDS ADebtToken", "aDebtUSDS", mockUSDS.address);
        await mockADebtTokenUSDS.deployed();

        const mockADebtTokenUSDT = await MockADebtToken.deploy("Mock USDT ADebtToken", "aDebtUSDT", mockUSDT.address);
        await mockADebtTokenUSDT.deployed();

        const mockADebtTokenWETH = await MockADebtToken.deploy("Mock WETH ADebtToken", "aDebtWETH", mockWETH.address);
        await mockADebtTokenWETH.deployed();

        // Deploy Aave Pool
        const MockAaveLendingPool = await ethers.getContractFactory("MockAavePool");
        const mockAavePool = await MockAaveLendingPool.deploy(
            mockATokenWETH.address,
            tokenContracts.WETH.address,
            mockADebtTokenDAI.address,
            tokenContracts.DAI.address
        );
        await mockAavePool.deployed();

        await mockAavePool.setPoll(
            mockATokenDAI.address,
            tokenContracts.DAI.address,
            mockADebtTokenUSDT.address,
            tokenContracts.USDT.address
        );

        await mockAavePool.setPoll(
            mockATokenUSDT.address,
            tokenContracts.USDT.address,
            mockADebtTokenUSDS.address,
            tokenContracts.USDS.address
        );

        // const mockAavePoolDaiUsdt = await MockAaveLendingPool.deploy(
        //     mockATokenDAI.address,
        //     tokenContracts.DAI.address,
        //     mockADebtTokenUSDT.address,
        //     tokenContracts.USDT.address
        // );
        // await mockAavePoolDaiUsdt.deployed();

        const aTokens: Record<string, MockAToken> = {
            WETH: mockATokenWETH,
            DAI: mockATokenDAI,
            USDT: mockATokenUSDT,
            USDS: mockATokenUSDS
        };

        const debtTokens: Record<string, MockADebtToken> = {
            DAI: mockADebtTokenDAI,
            USDS: mockADebtTokenUSDS,
            USDT: mockADebtTokenUSDT,
            WETH: mockADebtTokenWETH
        };

        // const aaveLendingPools: Record<string, MockAavePool> = {
        //     WetheDai: mockAavePoolWetheDai,
        //     DaiUsdt: mockAavePoolDaiUsdt
        // };

        const aaveContract = {
            aTokens,
            debtTokens,
            lendingPools: mockAavePool
        };

        // Deploy mock Spark Lending Pool with mock Spark Token and mock Debt Token
        // Deploy Spark spToken
        const MockSpToken = await ethers.getContractFactory("MockSpToken");
        const mockSpTokenWETH = await MockSpToken.deploy("Mock WETH spToken", "spWETH", mockWETH.address);
        await mockSpTokenWETH.deployed();

        const mockSpTokenDAI = await MockSpToken.deploy("Mock DAI spToken", "spDAI", mockDAI.address);
        await mockSpTokenDAI.deployed();

        const mockSpTokenUSDT = await MockSpToken.deploy("Mock USDT spToken", "spUSDT", mockUSDT.address);
        await mockSpTokenUSDT.deployed();

        const mockSpTokenUSDS = await MockSpToken.deploy("Mock USDS spToken", "spUSDS", mockUSDS.address);
        await mockSpTokenUSDS.deployed();

        // Deploy Spark spDebtToken
        const MockSpDebtToken = await ethers.getContractFactory("MockSpDebtToken");
        const mockSpDebtTokenDAI = await MockSpDebtToken.deploy("Mock DAI SpDebtToken", "spDebtDAI", mockDAI.address);
        await mockSpDebtTokenDAI.deployed();

        const mockSpDebtTokenUSDS = await MockSpDebtToken.deploy(
            "Mock USDS SpDebtToken",
            "spDebtUSDS",
            mockUSDS.address
        );
        await mockSpDebtTokenUSDS.deployed();

        const mockSpDebtTokenUSDT = await MockSpDebtToken.deploy(
            "Mock USDT SpDebtToken",
            "spDebtUSDT",
            mockUSDT.address
        );
        await mockSpDebtTokenUSDT.deployed();

        const mockSpDebtTokenWETH = await MockSpDebtToken.deploy(
            "Mock WETH SpDebtToken",
            "spDebtWETH",
            mockWETH.address
        );
        await mockSpDebtTokenWETH.deployed();

        // Deploy Spark Pool
        const MockSparkPool = await ethers.getContractFactory("MockSparkPool");
        const mockSparkPool = await MockSparkPool.deploy(
            mockSpTokenWETH.address,
            tokenContracts.WETH.address,
            mockSpDebtTokenDAI.address,
            tokenContracts.DAI.address
        );
        await mockSparkPool.deployed();

        await mockSparkPool.setPoll(
            mockSpTokenWETH.address,
            tokenContracts.WETH.address,
            mockSpDebtTokenUSDT.address,
            tokenContracts.USDT.address
        );

        await mockSparkPool.setPoll(
            mockSpTokenWETH.address,
            tokenContracts.WETH.address,
            mockSpDebtTokenUSDS.address,
            tokenContracts.USDS.address
        );

        await mockSparkPool.setPoll(
            mockSpTokenDAI.address,
            tokenContracts.DAI.address,
            mockSpDebtTokenUSDS.address,
            tokenContracts.USDS.address
        );

        const spTokens: Record<string, MockSpToken> = {
            WETH: mockSpTokenWETH,
            DAI: mockSpTokenDAI,
            USDT: mockSpTokenUSDT,
            USDS: mockSpTokenUSDS
        };

        const spDebtTokens: Record<string, MockSpDebtToken> = {
            DAI: mockSpDebtTokenDAI,
            USDS: mockSpDebtTokenUSDS,
            USDT: mockSpDebtTokenUSDT,
            WETH: mockSpDebtTokenWETH
        };

        // const sparkLendingPools: Record<string, MockSparkPool> = {
        //     WetheDai: mockSparkPoolWetheDai
        // };

        const sparkContract = {
            spTokens,
            spDebtTokens,
            lendingPools: mockSparkPool
        };

        // Deploy MockMorpho contract
        const MockMorpho = await ethers.getContractFactory("MockMorpho");
        const mockMorpho = await MockMorpho.deploy();

        const morphoMarketParams: Record<
            string,
            {
                loanToken: string;
                collateralToken: string;
                oracle: string;
                irm: string;
                lltv: number;
            }
        > = {
            // LoanToken_CollateralToken
            DAI_USDS: {
                loanToken: mockDAI.address,
                collateralToken: mockUSDS.address,
                oracle: ethers.constants.AddressZero,
                irm: ethers.constants.AddressZero,
                lltv: 7500
            },
            USDT_DAI: {
                loanToken: mockUSDT.address,
                collateralToken: mockDAI.address,
                oracle: ethers.constants.AddressZero,
                irm: ethers.constants.AddressZero,
                lltv: 7500
            },
            USDT_WETH: {
                loanToken: mockUSDT.address,
                collateralToken: mockWETH.address,
                oracle: ethers.constants.AddressZero,
                irm: ethers.constants.AddressZero,
                lltv: 7500
            },
            USDS_WETH: {
                loanToken: mockUSDS.address,
                collateralToken: mockWETH.address,
                oracle: ethers.constants.AddressZero,
                irm: ethers.constants.AddressZero,
                lltv: 7500
            }
        };

        await mockMorpho.setMarketParams(morphoMarketParams.DAI_USDS);
        await mockMorpho.setMarketParams(morphoMarketParams.USDT_DAI);
        await mockMorpho.setMarketParams(morphoMarketParams.USDT_WETH);
        await mockMorpho.setMarketParams(morphoMarketParams.USDS_WETH);
        // Define market parameters for Morpho
        const morphoMarketIds = {
            DAI_USDS: await mockMorpho.getMarketId(morphoMarketParams.DAI_USDS),
            USDT_DAI: await mockMorpho.getMarketId(morphoMarketParams.USDT_DAI),
            USDT_WETH: await mockMorpho.getMarketId(morphoMarketParams.USDT_WETH),
            USDS_WETH: await mockMorpho.getMarketId(morphoMarketParams.USDS_WETH)
        };

        // Fake Uniswap V3 Pool
        const FakeUniswapV3Pool = await ethers.getContractFactory("FakeUniswapV3Pool");
        const fakeUniswapV3Pool = await FakeUniswapV3Pool.deploy();
        await fakeUniswapV3Pool.deployed();

        // Deploy mock QuoterV2
        const MockQuoterV2 = await ethers.getContractFactory("MockQuoterV2");
        const mockQuoterV2 = await MockQuoterV2.deploy();
        await mockQuoterV2.deployed();

        // Deploy mock Uniswap V3 Pool for flash loans
        const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
        const uniswapV3PoolUsdsDai = await MockUniswapV3Pool.deploy(mockUSDS.address, mockDAI.address);
        await uniswapV3PoolUsdsDai.deployed();

        await uniswapV3PoolUsdsDai.setFakeUniswapV3Pool(fakeUniswapV3Pool.address);

        const uniswapV3PoolUsdtWeth = await MockUniswapV3Pool.deploy(mockUSDT.address, mockWETH.address);

        await uniswapV3PoolUsdtWeth.setFakeUniswapV3Pool(fakeUniswapV3Pool.address);

        // Deploy mock Swap Router
        const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
        const mockSwapRouter = await MockSwapRouter.deploy();
        await mockSwapRouter.deployed();
        // Deploy mock Swap Router02
        const MockSwapRouter02 = await ethers.getContractFactory("MockSwapRouter02");
        const mockSwapRouter02 = await MockSwapRouter02.deploy();
        await mockSwapRouter02.deployed();

        // Initial financing of contracts
        // Fund Swap Routers
        await mockDAI.transfer(mockSwapRouter.address, parseEther("2000"));
        await mockUSDS.transfer(mockSwapRouter.address, parseEther("2000"));
        await mockWETH.transfer(mockSwapRouter.address, parseEther("2000"));
        await mockUSDT.transfer(mockSwapRouter.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockSwapRouter.address,
            value: parseEther("2000")
        });

        await mockDAI.transfer(mockSwapRouter02.address, parseEther("2000"));
        await mockUSDS.transfer(mockSwapRouter02.address, parseEther("2000"));
        await mockWETH.transfer(mockSwapRouter02.address, parseEther("2000"));
        await mockUSDT.transfer(mockSwapRouter02.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockSwapRouter02.address,
            value: parseEther("2000")
        });

        // Fund Uniswap V3 Pool
        await mockDAI.transfer(uniswapV3PoolUsdsDai.address, parseEther("2000"));
        await mockUSDS.transfer(uniswapV3PoolUsdsDai.address, parseEther("2000"));
        // await mockWETH.transfer(uniswapV3PoolUsdsDai.address, parseEther("2000"));
        // await deployer.sendTransaction({
        //     to: uniswapV3PoolUsdsDai.address,
        //     value: parseEther("2000")
        // });

        await mockUSDT.transfer(uniswapV3PoolUsdtWeth.address, parseEther("2000"));
        await mockWETH.transfer(uniswapV3PoolUsdtWeth.address, parseEther("2000"));
        // Fund Aave Lending Pool
        await mockWETH.transfer(aaveContract.lendingPools.address, parseEther("2000"));
        await mockDAI.transfer(aaveContract.lendingPools.address, parseEther("2000"));
        await mockUSDT.transfer(aaveContract.lendingPools.address, parseEther("2000"));
        await mockUSDS.transfer(aaveContract.lendingPools.address, parseEther("2000"));

        // Fund Spark Lending Pool
        await mockWETH.transfer(sparkContract.lendingPools.address, parseEther("2000"));
        await mockDAI.transfer(sparkContract.lendingPools.address, parseEther("2000"));
        await mockUSDT.transfer(sparkContract.lendingPools.address, parseEther("2000"));
        await mockUSDS.transfer(sparkContract.lendingPools.address, parseEther("2000"));
        // await deployer.sendTransaction({
        //     to: mockSparkPool.address,
        //     value: parseEther("2000")
        // });
        // Fund Converter (DaiUsds)
        await mockDAI.transfer(mockDaiUsds.address, parseEther("2000"));
        await mockUSDS.transfer(mockDaiUsds.address, parseEther("2000"));
        // Fund Comet
        await mockUSDS.transfer(mockCometUsds.address, parseEther("2000"));
        await mockUSDT.transfer(mockCometUsdt.address, parseEther("2000"));
        // Fund Morpho
        await mockDAI.transfer(mockMorpho.address, parseEther("2000"));
        await mockUSDS.transfer(mockMorpho.address, parseEther("2000"));
        await mockUSDT.transfer(mockMorpho.address, parseEther("2000"));
        await mockWETH.transfer(mockMorpho.address, parseEther("2000"));

        return {
            deployer,
            // tokens
            mockDAI,
            mockUSDS,
            mockWETH,
            mockUSDT,
            // Aave
            aaveContract,
            // Spark
            sparkContract,
            // Morpho
            morphoMarketParams,
            morphoMarketIds,
            // other
            tokenContracts,
            mockDaiUsds,
            mockCometUsds,
            mockCometUsdt,
            uniswapV3PoolUsdsDai,
            uniswapV3PoolUsdtWeth,
            mockSwapRouter,
            mockSwapRouter02,
            mockMorpho,
            mockQuoterV2
        };
    }

    async function setupTestEnvironment() {
        const mocks = await setupMocks();

        const [_, owner, user, adapterDeployer] = await ethers.getSigners();

        // Deploy AaveV3UsdsAdapter
        const AaveV3UsdsAdapterFactory = await ethers.getContractFactory("AaveV3UsdsAdapter", adapterDeployer);
        const aaveV3UsdsAdapter = (await AaveV3UsdsAdapterFactory.connect(owner).deploy({
            uniswapRouter: mocks.mockSwapRouter.address,
            daiUsdsConverter: mocks.mockDaiUsds.address,
            dai: mocks.mockDAI.address,
            usds: mocks.mockUSDS.address,
            aaveLendingPool: mocks.aaveContract.lendingPools.address,
            aaveDataProvider: mocks.aaveContract.lendingPools.address,
            isFullMigration: true,
            useSwapRouter02: false
        })) as AaveV3UsdsAdapter;
        await aaveV3UsdsAdapter.deployed();

        // // Deploy AaveV3Adapter
        // const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", adapterDeployer);
        // const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
        //     uniswapRouter: mocks.mockSwapRouter.address,
        //     aaveLendingPool: mocks.aaveContract.lendingPools.address,
        //     aaveDataProvider: mocks.aaveContract.lendingPools.address,
        //     isFullMigration: true,
        //     useSwapRouter02: false
        // })) as AaveV3Adapter;
        // await aaveV3Adapter.deployed();

        // Deploy SparkUsdsAdapter
        const SparkUsdsAdapterFactory = await ethers.getContractFactory("SparkUsdsAdapter", adapterDeployer);
        const sparkUsdsAdapter = (await SparkUsdsAdapterFactory.connect(owner).deploy({
            uniswapRouter: mocks.mockSwapRouter02.address,
            daiUsdsConverter: mocks.mockDaiUsds.address,
            dai: mocks.mockDAI.address,
            usds: mocks.mockUSDS.address,
            sparkLendingPool: mocks.sparkContract.lendingPools.address,
            sparkDataProvider: mocks.sparkContract.lendingPools.address,
            isFullMigration: true,
            useSwapRouter02: true
        })) as SparkUsdsAdapter;
        await sparkUsdsAdapter.deployed();

        // // Deploy SparkAdapter
        // const SparkAdapterFactory = await ethers.getContractFactory("SparkAdapter", adapterDeployer);
        // const sparkAdapter = (await SparkAdapterFactory.connect(owner).deploy({
        //     uniswapRouter: mocks.mockSwapRouter02.address,
        //     sparkLendingPool: mocks.sparkContract.lendingPools.address,
        //     sparkDataProvider: mocks.sparkContract.lendingPools.address,
        //     isFullMigration: true,
        //     useSwapRouter02: true
        // })) as SparkAdapter;
        // await sparkAdapter.deployed();

        // Deploy MorphoUsdsAdapter
        const MorphoUsdsAdapterFactory = await ethers.getContractFactory("MorphoUsdsAdapter", adapterDeployer);
        const morphoUsdsAdapter = (await MorphoUsdsAdapterFactory.connect(owner).deploy({
            uniswapRouter: mocks.mockSwapRouter.address,
            daiUsdsConverter: mocks.mockDaiUsds.address,
            dai: mocks.mockDAI.address,
            usds: mocks.mockUSDS.address,
            morphoLendingPool: mocks.mockMorpho.address,
            isFullMigration: true,
            useSwapRouter02: false
        })) as MorphoUsdsAdapter;
        await morphoUsdsAdapter.deployed();

        // // Deploy MorphoAdapter
        // const MorphoAdapterFactory = await ethers.getContractFactory("MorphoAdapter", adapterDeployer);
        // const morphoAdapter = (await MorphoAdapterFactory.connect(owner).deploy({
        //     uniswapRouter: mocks.mockSwapRouter.address,
        //     morphoLendingPool: mocks.mockMorpho.address,
        //     isFullMigration: true,
        //     useSwapRouter02: false
        // })) as MorphoAdapter;
        // await morphoAdapter.deployed();

        const adapters = [
            aaveV3UsdsAdapter.address,
            sparkUsdsAdapter.address,
            morphoUsdsAdapter.address
            // aaveV3Adapter.address,
            // sparkAdapter.address,
            // morphoAdapter.address
        ];
        const comets = [mocks.mockCometUsds.address, mocks.mockCometUsdt.address];

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: mocks.uniswapV3PoolUsdsDai.address,
                // baseToken: mocks.mockUSDS.address,
                // isToken0: true
                baseToken: mocks.mockDAI.address,
                isToken0: false
            },
            {
                liquidityPool: mocks.uniswapV3PoolUsdtWeth.address,
                baseToken: mocks.mockUSDT.address,
                isToken0: true
            }
        ];

        const MigratorV2Factory = await ethers.getContractFactory("MigratorV2");
        const migrator = await MigratorV2Factory.connect(owner).deploy(
            owner.address,
            adapters,
            comets,
            flashData,
            mocks.tokenContracts.DAI.address,
            mocks.tokenContracts.USDS.address
        );
        await migrator.deployed();

        // Deploy UniswapV3PathFinder contract
        const UniswapV3PathFinderFactory = await ethers.getContractFactory("UniswapV3PathFinder");
        const uniswapV3PathFinder = await UniswapV3PathFinderFactory.deploy(
            mocks.mockQuoterV2.address,
            mocks.mockQuoterV2.address,
            mocks.tokenContracts.DAI.address,
            mocks.tokenContracts.USDS.address
        );
        await uniswapV3PathFinder.deployed();

        const contractsFactory = {
            AaveV3UsdsAdapterFactory,
            // AaveV3AdapterFactory,
            SparkUsdsAdapterFactory,
            // SparkAdapterFactory,
            MorphoUsdsAdapterFactory,
            // MorphoAdapterFactory,
            MigratorV2Factory
        };

        return {
            mocks,
            owner,
            user,
            adapterDeployer,
            aaveV3UsdsAdapter,
            sparkUsdsAdapter,
            morphoUsdsAdapter,
            // aaveV3Adapter,
            // sparkAdapter,
            // morphoAdapter,
            migrator,
            contractsFactory,
            uniswapV3PathFinder
        };
    }

    describe("# Deployment", function () {
        // context("* AaveV3Adapter", async () => {
        //     it("Should deploy AaveV3Adapter to a proper address", async () => {
        //         const { aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
        //         expect(aaveV3UsdsAdapter.address).to.be.properAddress;
        //     });

        //     it("Should have correct dependencies", async () => {
        //         const { aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         expect(await aaveV3UsdsAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter.address);
        //         expect(await aaveV3UsdsAdapter.DAI_USDS_CONVERTER()).to.equal(mocks.mockDaiUsds.address);
        //         expect(await aaveV3UsdsAdapter.DAI()).to.equal(mocks.mockDAI.address);
        //         expect(await aaveV3UsdsAdapter.USDS()).to.equal(mocks.mockUSDS.address);
        //         expect(await aaveV3UsdsAdapter.LENDING_POOL()).to.equal(mocks.aaveContract.lendingPools.address);
        //     });

        //     it("Should revert if invalid constructor parameters", async () => {
        //         const { mocks, adapterDeployer, aaveV3Adapter } = await loadFixture(setupTestEnvironment);
        //         const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", adapterDeployer);
        //         await expect(
        //             AaveV3AdapterFactory.deploy({
        //                 uniswapRouter: AddressZero, ///< Invalid address
        //                 aaveLendingPool: mocks.aaveContract.lendingPools.address,
        //                 aaveDataProvider: mocks.aaveContract.lendingPools.address,
        //                 isFullMigration: false,
        //                 useSwapRouter02: false
        //             })
        //         ).to.be.revertedWithCustomError(aaveV3Adapter, "InvalidZeroAddress");

        //         await expect(
        //             AaveV3AdapterFactory.deploy({
        //                 uniswapRouter: mocks.mockSwapRouter.address,
        //                 aaveLendingPool: mocks.aaveContract.lendingPools.address,
        //                 aaveDataProvider: AddressZero, ///< Invalid address
        //                 isFullMigration: false,
        //                 useSwapRouter02: false
        //             })
        //         ).to.be.revertedWithCustomError(aaveV3Adapter, "InvalidZeroAddress");
        //     });
        // });

        context("* AaveV3UsdsAdapter", async () => {
            it("Should deploy AaveV3UsdsAdapter to a proper address", async () => {
                const { aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                expect(aaveV3UsdsAdapter.address).to.be.properAddress;
            });

            it("Should revert if invalid constructor parameters", async () => {
                const { mocks, adapterDeployer, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                const AaveV3UsdsAdapterFactory = await ethers.getContractFactory("AaveV3UsdsAdapter", adapterDeployer);
                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: AddressZero, ///< Invalid address
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: AddressZero, ///< Invalid address
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: AddressZero, ///< Invalid address
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: AddressZero, ///< Invalid address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: AddressZero, ///< Invalid address
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: AddressZero, ///< Invalid address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");
            });

            it("Should revert if invalid constructor parameters", async () => {
                const { mocks, adapterDeployer, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                const AaveV3UsdsAdapterFactory = await ethers.getContractFactory("AaveV3UsdsAdapter", adapterDeployer);
                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: AddressZero, ///< Invalid address
                        aaveDataProvider: mocks.aaveContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");

                await expect(
                    AaveV3UsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        aaveLendingPool: mocks.aaveContract.lendingPools.address,
                        aaveDataProvider: AddressZero, ///< Invalid address
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidZeroAddress");
            });
        });

        // context("* SparkAdapter", async () => {
        //     it("Should deploy SparkAdapter to a proper address", async () => {
        //         const { sparkAdapter } = await loadFixture(setupTestEnvironment);
        //         expect(sparkAdapter.address).to.be.properAddress;
        //     });

        //     it("Should have correct dependencies", async () => {
        //         const { sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         expect(await sparkAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter02.address);
        //         expect(await sparkAdapter.LENDING_POOL()).to.equal(mocks.sparkContract.lendingPools.address);
        //     });

        //     it("Should revert if invalid constructor parameters", async () => {
        //         const { mocks, adapterDeployer, sparkAdapter } = await loadFixture(setupTestEnvironment);
        //         const SparkAdapterFactory = await ethers.getContractFactory("SparkAdapter", adapterDeployer);
        //         await expect(
        //             SparkAdapterFactory.deploy({
        //                 uniswapRouter: mocks.mockSwapRouter.address,
        //                 sparkLendingPool: AddressZero, ///< Invalid address
        //                 sparkDataProvider: mocks.sparkContract.lendingPools.address,
        //                 isFullMigration: false,
        //                 useSwapRouter02: false
        //             })
        //         ).to.be.revertedWithCustomError(sparkAdapter, "InvalidZeroAddress");

        //         await expect(
        //             SparkAdapterFactory.deploy({
        //                 uniswapRouter: mocks.mockSwapRouter.address,
        //                 sparkLendingPool: mocks.sparkContract.lendingPools.address,
        //                 sparkDataProvider: AddressZero, ///< Invalid address
        //                 isFullMigration: false,
        //                 useSwapRouter02: false
        //             })
        //         ).to.be.revertedWithCustomError(sparkAdapter, "InvalidZeroAddress");
        //     });
        // });

        context("* SparkUsdsAdapter", async () => {
            it("Should deploy SparkUsdsAdapter to a proper address", async () => {
                const { sparkUsdsAdapter } = await loadFixture(setupTestEnvironment);
                expect(sparkUsdsAdapter.address).to.be.properAddress;
            });

            it("Should have correct dependencies", async () => {
                const { sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                expect(await sparkUsdsAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter02.address);
                expect(await sparkUsdsAdapter.DAI_USDS_CONVERTER()).to.equal(mocks.mockDaiUsds.address);
                expect(await sparkUsdsAdapter.DAI()).to.equal(mocks.mockDAI.address);
                expect(await sparkUsdsAdapter.USDS()).to.equal(mocks.mockUSDS.address);
                expect(await sparkUsdsAdapter.LENDING_POOL()).to.equal(mocks.sparkContract.lendingPools.address);
            });

            it("Should revert if invalid constructor parameters", async () => {
                const { mocks, adapterDeployer, sparkUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const SparkUsdsAdapterFactory = await ethers.getContractFactory("SparkUsdsAdapter", adapterDeployer);
                await expect(
                    SparkUsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        sparkLendingPool: AddressZero, ///< Invalid address
                        sparkDataProvider: mocks.sparkContract.lendingPools.address,
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(sparkUsdsAdapter, "InvalidZeroAddress");

                await expect(
                    SparkUsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        sparkLendingPool: mocks.sparkContract.lendingPools.address,
                        sparkDataProvider: AddressZero, ///< Invalid address
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(sparkUsdsAdapter, "InvalidZeroAddress");
            });
        });

        // context("* MorphoAdapter", async () => {
        //     it("Should deploy MorphoAdapter to a proper address", async () => {
        //         const { morphoAdapter } = await loadFixture(setupTestEnvironment);
        //         expect(morphoAdapter.address).to.be.properAddress;
        //     });

        //     it("Should have correct dependencies", async () => {
        //         const { morphoAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         expect(await morphoAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter.address);
        //         expect(await morphoAdapter.LENDING_POOL()).to.equal(mocks.mockMorpho.address);
        //     });

        //     it("Should revert if invalid constructor parameters", async () => {
        //         const { mocks, adapterDeployer, morphoAdapter } = await loadFixture(setupTestEnvironment);
        //         const MorphoAdapterFactory = await ethers.getContractFactory("MorphoAdapter", adapterDeployer);
        //         await expect(
        //             MorphoAdapterFactory.deploy({
        //                 uniswapRouter: mocks.mockSwapRouter.address,
        //                 morphoLendingPool: AddressZero, ///< Invalid address
        //                 isFullMigration: false,
        //                 useSwapRouter02: false
        //             })
        //         ).to.be.revertedWithCustomError(morphoAdapter, "InvalidZeroAddress");
        //     });
        // });

        context("* MorphoUsdsAdapter", async () => {
            it("Should deploy MorphoUsdsAdapter to a proper address", async () => {
                const { morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                expect(morphoUsdsAdapter.address).to.be.properAddress;
            });

            it("Should have correct dependencies", async () => {
                const { morphoUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                expect(await morphoUsdsAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter.address);
                expect(await morphoUsdsAdapter.DAI_USDS_CONVERTER()).to.equal(mocks.mockDaiUsds.address);
                expect(await morphoUsdsAdapter.DAI()).to.equal(mocks.mockDAI.address);
                expect(await morphoUsdsAdapter.USDS()).to.equal(mocks.mockUSDS.address);
                expect(await morphoUsdsAdapter.LENDING_POOL()).to.equal(mocks.mockMorpho.address);
            });

            it("Should revert if invalid constructor parameters", async () => {
                const { mocks, adapterDeployer, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const MorphoUsdsAdapterFactory = await ethers.getContractFactory("MorphoUsdsAdapter", adapterDeployer);
                await expect(
                    MorphoUsdsAdapterFactory.deploy({
                        uniswapRouter: mocks.mockSwapRouter.address,
                        daiUsdsConverter: mocks.mockDaiUsds.address,
                        dai: mocks.mockDAI.address,
                        usds: mocks.mockUSDS.address,
                        morphoLendingPool: AddressZero, ///< Invalid address
                        isFullMigration: false,
                        useSwapRouter02: false
                    })
                ).to.be.revertedWithCustomError(morphoUsdsAdapter, "InvalidZeroAddress");
            });
        });

        context("* MigratorV2", async () => {
            it("Should deploy MigratorV2 to a proper address", async () => {
                const { migrator } = await loadFixture(setupTestEnvironment);
                expect(migrator.address).to.be.properAddress;
            });

            it("Should have correct owner", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                expect(await migrator.owner()).to.equal(owner.address);
            });

            it("Should have correct adapter registered", async () => {
                const { migrator, aaveV3UsdsAdapter, sparkUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const adapters = await migrator.getAdapters();
                expect(adapters).to.include(aaveV3UsdsAdapter.address);
                expect(adapters).to.include(sparkUsdsAdapter.address);
            });

            it("Should revert if invalid constructor parameters", async () => {
                const { mocks, adapterDeployer, migrator } = await loadFixture(setupTestEnvironment);
                const MigratorV2Factory = await ethers.getContractFactory("MigratorV2", adapterDeployer);

                await expect(
                    MigratorV2Factory.deploy(
                        mocks.mockSwapRouter.address,
                        [],
                        [mocks.mockCometUsdt.address],
                        [],
                        AddressZero,
                        AddressZero
                    )
                ).to.be.revertedWithCustomError(migrator, "MismatchedArrayLengths");
            });
        });
    });

    describe("# Migrate functionality", function () {
        context("* Testing negative scenarios", async () => {
            it("Should revert if migrator is paused", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks, owner } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - USDS
                const borrowAmounts = {
                    USDS: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.USDS.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                // Pause the migrator
                await migrator.connect(owner).pause();

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(migrator, "EnforcedPause");
            });

            it("Should revert if fake pool", async () => {
                const { migrator, user, aaveV3UsdsAdapter, owner, mocks } = await loadFixture(setupTestEnvironment);
                const { mockCometUsds, uniswapV3PoolUsdsDai } = mocks;

                await uniswapV3PoolUsdsDai.setNegativeTest(NEGATIVE_TEST.FakeUniswapV3Pool);

                // Testing without setup the required data and conditions
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(migrator, "SenderNotUniswapPool");
            });

            it("Should revert if invalid callback data", async () => {
                const { migrator, user, aaveV3UsdsAdapter, owner, mocks } = await loadFixture(setupTestEnvironment);
                const { mockCometUsds, uniswapV3PoolUsdsDai } = mocks;

                await uniswapV3PoolUsdsDai.setNegativeTest(NEGATIVE_TEST.InvalidCallbackData);

                // Testing without setup the required data and conditions
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(migrator, "InvalidCallbackHash");
            });

            it("Should revert if reentrancy is detected", async () => {
                const { migrator, user, aaveV3UsdsAdapter, owner, mocks } = await loadFixture(setupTestEnvironment);
                const { mockCometUsds, uniswapV3PoolUsdsDai } = mocks;

                await uniswapV3PoolUsdsDai.setNegativeTest(NEGATIVE_TEST.Reentrant);

                // Testing without setup the required data and conditions
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(migrator, "ReentrancyGuardReentrantCall");
            });

            it("Should revert if invalid adapter is used", async () => {
                const { migrator, user, mocks } = await loadFixture(setupTestEnvironment);
                await expect(
                    migrator.connect(user).migrate(AddressZero, mocks.mockCometUsds.address, "0x", parseEther("100"))
                ).to.be.revertedWithCustomError(migrator, "InvalidAdapter");
            });

            it("Should revert if migration data is empty", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, "0x", parseEther("100"))
                ).to.be.revertedWithCustomError(migrator, "InvalidMigrationData");
            });

            // it("Should revert if Comet is not supported", async () => {
            //     const { migrator, user, sparkAdapter } = await loadFixture(setupTestEnvironment);
            //     await expect(
            //         migrator.connect(user).migrate(sparkAdapter.address, AddressZero, "0x", parseEther("100"))
            //     ).to.be.revertedWithCustomError(migrator, "CometIsNotSupported");
            // });

            it("Should revert if conversion fail", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockDaiUsds } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    DAI: parseEther("700")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }
                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.DAI.address,
                            amount: parseEther("700"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                await mockDaiUsds.setTestingNegativeScenario(true);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "ConversionFailed");

                const userBalancesAfter = {
                    collateralsAave: {
                        DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(userBalancesBefore.collateralsAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should revert if swap fail | borrow position", async () => {
                // done
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await mockSwapRouter.setNegativeTest(NEGATIVE_TEST.SwapRouterNotSupported);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWith("Negative scenario: SwapRouter not supported");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
                expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should revert if swap fail | zero amount out", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: Zero,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "ZeroAmountOut");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
                expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });
            it("Should revert if swap fail | zero amount in", async () => {
                // teat
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: borrowAmounts.DAI,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: Zero,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "ZeroAmountIn");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
                expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should revert if swap fail | collateral position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.DAI.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await mockSwapRouter.setNegativeTest(NEGATIVE_TEST.SwapRouterNotSupported);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWith("Negative scenario: SwapRouter not supported");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
                expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });

            // it("Should revert if debt token is not cleared: aaveV3Adapter", async () => {
            //     const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
            //     const { tokenContracts, aaveContract } = mocks;

            //     const aaveLendingPool = aaveContract.lendingPools;

            //     const supplyAmounts = {
            //         WETH: parseEther("500")
            //     };

            //     // Setup for AaveV3 -> Comet migration
            //     // Fund user with tokens
            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

            //         if ("mint" in tokenContract) {
            //             await tokenContract.connect(user).mint(amount);
            //         } else {
            //             await tokenContract.connect(user).deposit({ value: amount });
            //         }

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const aTokenContract = aaveContract.aTokens[token];
            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         // Approve token and deposit to Aave
            //         await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
            //         await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Borrow from Aave - DAI
            //     const borrowAmounts = {
            //         DAI: parseEther("100")
            //     };

            //     for (const [token, amount] of Object.entries(borrowAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const debtTokenContract = aaveContract.debtTokens[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Init migration
            //     // Approve migration

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const aTokenContract = aaveContract.aTokens[token];
            //         await aTokenContract.connect(user).approve(migrator.address, amount);
            //     }

            //     const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

            //     const position = {
            //         borrows: [
            //             {
            //                 debtToken: mocks.aaveContract.debtTokens.DAI.address,
            //                 amount: MaxUint256,
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountInMaximum: parseEther("100")
            //                 }
            //             }
            //         ],

            //         collaterals: [
            //             {
            //                 aToken: mocks.aaveContract.aTokens.WETH.address,
            //                 amount: parseEther("500"),
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
            //                         FEE_100,
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountOutMinimum: 1n
            //                 }
            //             }
            //         ]
            //     };

            //     // Encode the data
            //     const migrationData = ethers.utils.defaultAbiCoder.encode(
            //         ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
            //         [[position.borrows, position.collaterals]]
            //     );

            //     const userBalancesBefore = {
            //         collateralsAave: {
            //             WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
            //         },
            //         borrowAave: {
            //             DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
            //         },
            //         collateralsComet: {
            //             WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
            //             USDS: await mocks.mockCometUsds.balanceOf(user.address)
            //         }
            //     };

            //     logger("\nuserBalancesAfter", userBalancesBefore);

            //     const flashAmount = parseEther("500");

            //     // Fake a partial debt closure
            //     await aaveLendingPool.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

            //     await expect(
            //         migrator
            //             .connect(user)
            //             .migrate(aaveV3Adapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
            //     ).to.be.revertedWithCustomError(aaveV3Adapter, "DebtNotCleared");

            //     const userBalancesAfter = {
            //         collateralsAave: {
            //             WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
            //         },
            //         borrowAave: {
            //             DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
            //         },
            //         collateralsComet: {
            //             WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
            //             USDS: await mocks.mockCometUsds.balanceOf(user.address)
            //         }
            //     };

            //     logger("\nuserBalancesAfter", userBalancesAfter);

            //     // Check user balances after migration - Aave
            //     expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
            //     expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
            //     // Check user balances after migration - Comet
            //     expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
            //     expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            // });

            it("Should revert if debt token is not cleared: aaveV3UsdsAdapter", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockCometUsdt, mockWETH } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                // Fake a partial debt closure
                await aaveLendingPool.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "DebtNotCleared");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        DAI: await aaveContract.debtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(userBalancesBefore.collateralsAave.WETH);
                expect(userBalancesAfter.borrowAave.DAI).to.be.equal(userBalancesBefore.borrowAave.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDT).to.be.equal(userBalancesBefore.collateralsComet.USDT);
            });

            // it("Should revert if debt token is not cleared: sparkAdapter", async () => {
            //     const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
            //     const { tokenContracts, sparkContract, mockCometUsds } = mocks;

            //     const sparkLendingPool = sparkContract.lendingPools;

            //     const supplyAmounts = {
            //         WETH: parseEther("500")
            //     };

            //     // Setup for AaveV3 -> Comet migration
            //     // Fund user with tokens
            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

            //         if ("mint" in tokenContract) {
            //             await tokenContract.connect(user).mint(amount);
            //         } else {
            //             await tokenContract.connect(user).deposit({ value: amount });
            //         }

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const aTokenContract = sparkContract.spTokens[token];
            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         // Approve token and deposit to Aave
            //         await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
            //         await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Borrow from Aave - DAI
            //     const borrowAmounts = {
            //         DAI: parseEther("100")
            //     };

            //     for (const [token, amount] of Object.entries(borrowAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const debtTokenContract = sparkContract.spDebtTokens[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Init migration
            //     // Approve migration

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const spTokenContract = sparkContract.spTokens[token];
            //         await spTokenContract.connect(user).approve(migrator.address, amount);
            //     }

            //     const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

            //     const position = {
            //         borrows: [
            //             {
            //                 debtToken: sparkContract.spDebtTokens.DAI.address,
            //                 amount: MaxUint256,
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20),
            //                         ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountInMaximum: parseEther("100")
            //                 }
            //             }
            //         ],

            //         collaterals: [
            //             {
            //                 spToken: sparkContract.spTokens.WETH.address,
            //                 amount: parseEther("500"),
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
            //                         FEE_100,
            //                         ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountOutMinimum: 1n
            //                 }
            //             }
            //         ]
            //     };

            //     // Encode the data
            //     const migrationData = ethers.utils.defaultAbiCoder.encode(
            //         ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
            //         [[position.borrows, position.collaterals]]
            //     );

            //     const userBalancesBefore = {
            //         collateralsSpark: {
            //             WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
            //         },
            //         borrowSpark: {
            //             DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
            //         },
            //         collateralsComet: {
            //             WETH: await mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
            //             USDS: await mockCometUsds.balanceOf(user.address)
            //         }
            //     };

            //     logger("\nuserBalancesAfter", userBalancesBefore);

            //     const flashAmount = parseEther("500");

            //     // Fake a partial debt closure
            //     await sparkLendingPool.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

            //     await expect(
            //         migrator
            //             .connect(user)
            //             .migrate(sparkAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
            //     ).to.be.revertedWithCustomError(sparkAdapter, "DebtNotCleared");

            //     const userBalancesAfter = {
            //         collateralsSpark: {
            //             WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
            //         },
            //         borrowSpark: {
            //             DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
            //         },
            //         collateralsComet: {
            //             WETH: await mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
            //             USDS: await mockCometUsds.balanceOf(user.address)
            //         }
            //     };

            //     logger("\nuserBalancesAfter", userBalancesAfter);

            //     // Check user balances after migration - Spark
            //     expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(userBalancesBefore.collateralsSpark.WETH);
            //     expect(userBalancesAfter.borrowSpark.DAI).to.be.equal(userBalancesBefore.borrowSpark.DAI);
            //     // Check user balances after migration - Comet
            //     expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
            //     expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            // });

            it("Should revert if debt token is not cleared: sparkUsdsAdapter", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsds } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = sparkContract.spTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = sparkContract.spDebtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: sparkContract.spDebtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: "0x",
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                // Fake a partial debt closure
                await sparkLendingPool.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(sparkUsdsAdapter, "DebtNotCleared");

                const userBalancesAfter = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(userBalancesBefore.collateralsSpark.WETH);
                expect(userBalancesAfter.borrowSpark.DAI).to.be.equal(userBalancesBefore.borrowSpark.DAI);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
            });

            // it("Should revert if debt token is not cleared: morphoAdapter", async () => {
            //     const { migrator, user, mocks, morphoAdapter } = await loadFixture(setupTestEnvironment);
            //     const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

            //     const supplyData = {
            //         USDS: { market: "DAI_USDS", supplyAmount: parseEther("500") }
            //     };

            //     // Setup for Morpho -> Comet migration
            //     // Fund user with tokens
            //     for (const [token, data] of Object.entries(supplyData)) {
            //         const tokenContract = tokenContracts[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

            //         if ("mint" in tokenContract) {
            //             await tokenContract.connect(user).mint(data.supplyAmount);
            //         } else {
            //             await tokenContract.connect(user).deposit({ value: data.supplyAmount });
            //         }

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
            //     }

            //     // Supply collateral to Morpho
            //     for (const [token, data] of Object.entries(supplyData)) {
            //         const tokenContract = tokenContracts[token];
            //         const marketParams = morphoMarketParams[data.market];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

            //         await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

            //         await mockMorpho
            //             .connect(user)
            //             .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
            //     }

            //     const borrowAData = {
            //         DAI: { marketId: "DAI_USDS", borrowAmount: parseEther("100") }
            //     };

            //     for (const [token, data] of Object.entries(borrowAData)) {
            //         const tokenContract = tokenContracts[token];
            //         const marketParams = morphoMarketParams[data.marketId];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

            //         // Borrow from Morpho
            //         await mocks.mockMorpho
            //             .connect(user)
            //             .borrow(marketParams, data.borrowAmount, 0, user.address, user.address);

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(data.borrowAmount);
            //     }

            //     // Create migration position
            //     const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

            //     const position = {
            //         borrows: [
            //             {
            //                 marketId: morphoMarketIds.DAI_USDS,
            //                 assetsAmount: borrowAData.DAI.borrowAmount,
            //                 swapParams: {
            //                     path: "0x",
            //                     deadline,
            //                     amountInMaximum: borrowAData.DAI.borrowAmount
            //                 }
            //             }
            //         ],
            //         collaterals: [
            //             {
            //                 marketId: morphoMarketIds.DAI_USDS,
            //                 assetsAmount: supplyData.USDS.supplyAmount,
            //                 swapParams: {
            //                     path: "0x",
            //                     deadline,
            //                     amountOutMinimum: 1n
            //                 }
            //             }
            //         ]
            //     };

            //     // Encode the data
            //     const migrationData = ethers.utils.defaultAbiCoder.encode(
            //         ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
            //         [[position.borrows, position.collaterals]]
            //     );

            //     const userBalancesBefore = {
            //         collateralMorpho: {
            //             USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
            //         },
            //         borrowMorpho: {
            //             DAI: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).borrowShares
            //         },
            //         collateralsComet: {
            //             USDS: await mocks.mockCometUsds.balanceOf(user.address)
            //         }
            //     };

            //     logger("\nuserBalancesAfter", userBalancesBefore);

            //     const flashAmount = parseEther("100");
            //     // Fake a partial debt closure
            //     await mockMorpho.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

            //     // Execute migration
            //     await expect(
            //         migrator
            //             .connect(user)
            //             .migrate(morphoAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
            //     ).to.be.revertedWithCustomError(morphoAdapter, "DebtNotCleared");
            // });

            it("Should revert if debt token is not cleared: morphoUsdsAdapter", async () => {
                const { migrator, user, mocks, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

                const supplyData = {
                    USDS: { market: "DAI_USDS", supplyAmount: parseEther("500") }
                };

                // Setup for Morpho -> Comet migration
                // Fund user with tokens
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(data.supplyAmount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: data.supplyAmount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
                }

                // Supply collateral to Morpho
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.market];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

                    await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

                    await mockMorpho
                        .connect(user)
                        .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                }

                const borrowAData = {
                    DAI: { marketId: "DAI_USDS", borrowAmount: parseEther("100") }
                };

                for (const [token, data] of Object.entries(borrowAData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.marketId];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Borrow from Morpho
                    await mocks.mockMorpho
                        .connect(user)
                        .borrow(marketParams, data.borrowAmount, 0, user.address, user.address);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.borrowAmount);
                }

                // Create migration position
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            marketId: morphoMarketIds.DAI_USDS,
                            assetsAmount: borrowAData.DAI.borrowAmount,
                            swapParams: {
                                path: "0x",
                                deadline,
                                amountInMaximum: borrowAData.DAI.borrowAmount
                            }
                        }
                    ],
                    collaterals: [
                        {
                            marketId: morphoMarketIds.DAI_USDS,
                            assetsAmount: supplyData.USDS.supplyAmount,
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
                    ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralMorpho: {
                        USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
                    },
                    borrowMorpho: {
                        DAI: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).borrowShares
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("100");
                // Fake a partial debt closure
                await mockMorpho.setNegativeTest(NEGATIVE_TEST.DebtNotCleared);

                // Execute migration
                await expect(
                    migrator
                        .connect(user)
                        .migrate(morphoUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(morphoUsdsAdapter, "DebtNotCleared");
            });

            // it("Should revert if trying to reenter migration function on the adapter: aaveV3Adapter", async () => {
            //     const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
            //     const { tokenContracts, aaveContract, mockSwapRouter } = mocks;

            //     const aaveLendingPool = aaveContract.lendingPools;

            //     const supplyAmounts = {
            //         WETH: parseEther("500")
            //     };

            //     // Setup for AaveV3 -> Comet migration
            //     // Fund user with tokens
            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

            //         if ("mint" in tokenContract) {
            //             await tokenContract.connect(user).mint(amount);
            //         } else {
            //             await tokenContract.connect(user).deposit({ value: amount });
            //         }

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const aTokenContract = aaveContract.aTokens[token];
            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         // Approve token and deposit to Aave
            //         await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
            //         await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

            //         expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Borrow from Aave - DAI
            //     const borrowAmounts = {
            //         DAI: parseEther("100")
            //     };

            //     for (const [token, amount] of Object.entries(borrowAmounts)) {
            //         const tokenContract = tokenContracts[token];
            //         const debtTokenContract = aaveContract.debtTokens[token];
            //         expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

            //         await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

            //         expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
            //         expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
            //     }

            //     // Init migration
            //     // Approve migration

            //     for (const [token, amount] of Object.entries(supplyAmounts)) {
            //         const aTokenContract = aaveContract.aTokens[token];
            //         await aTokenContract.connect(user).approve(migrator.address, amount);
            //     }

            //     const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

            //     const position = {
            //         borrows: [
            //             {
            //                 debtToken: mocks.aaveContract.debtTokens.DAI.address,
            //                 amount: MaxUint256,
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20),
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountInMaximum: parseEther("100")
            //                 }
            //             }
            //         ],

            //         collaterals: [
            //             {
            //                 aToken: mocks.aaveContract.aTokens.WETH.address,
            //                 amount: parseEther("500"),
            //                 swapParams: {
            //                     path: ethers.utils.concat([
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
            //                         FEE_100,
            //                         ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
            //                     ]),
            //                     deadline,
            //                     amountOutMinimum: 1n
            //                 }
            //             }
            //         ]
            //     };

            //     // Encode the data
            //     const migrationData = ethers.utils.defaultAbiCoder.encode(
            //         ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
            //         [[position.borrows, position.collaterals]]
            //     );

            //     const flashAmount = parseEther("100");

            //     // Fake a partial debt closure
            //     await mockSwapRouter.setNegativeTest(NEGATIVE_TEST.Reentrant);

            //     await expect(
            //         migrator
            //             .connect(user)
            //             .migrate(aaveV3Adapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
            //         // ).to.be.revertedWithCustomError(aaveV3Adapter, "ReentrancyGuardReentrantCall"); ///< Because of the construction try-catch
            //     ).to.be.revertedWithCustomError(migrator, "DelegatecallFailed");
            // });

            it("Should revert if trying to reenter migration function on the adapter: aaveV3UsdsAdapter", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter, mockCometUsdt, mockWETH } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                // Fake a partial debt closure
                await mockSwapRouter.setAdapter(aaveV3UsdsAdapter.address);
                await mockSwapRouter.setNegativeTest(NEGATIVE_TEST.Reentrant);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(migrator, "DelegatecallFailed");
            });

            it("Should revert if outdated swap deadline for borrow position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter, mockCometUsdt, mockWETH } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline: deadline.div(2), // << Outdated deadline
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidSwapDeadline");
            });

            it("Should revert if swap deadline is zero for borrow position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockCometUsdt } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline: Zero, // << Invalid deadline
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidSwapDeadline");
            });

            it("Should revert if outdated swap deadline for collateral position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter, mockCometUsdt, mockWETH } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline: deadline.div(2), // << Outdated deadline
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidSwapDeadline");
            });

            it("Should revert if swap deadline is zero for collateral position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockCometUsdt } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline: Zero, // << Invalid deadline
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidSwapDeadline");
            });

            it("Should revert if set zero slippage for swap borrow position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockCometUsdt } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: Zero // << Invalid slippage
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "ZeroAmountInMaximum");
            });

            it("Should revert if set zero slippage for swap collateral position", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockCometUsdt } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = BigNumber.from(
                    await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000)
                );

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: Zero // << Invalid slippage
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "ZeroAmountOutMinimum");
            });

            it("Should revert if swap deadline is zero ", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract, mockSwapRouter, mockCometUsdt } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = Zero;

                const position = {
                    borrows: [
                        {
                            debtToken: aaveContract.debtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const flashAmount = parseEther("100");

                // Fake a partial debt closure
                await mockSwapRouter.setAdapter(aaveV3UsdsAdapter.address);
                await mockSwapRouter.setNegativeTest(NEGATIVE_TEST.Reentrant);

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.be.revertedWithCustomError(aaveV3UsdsAdapter, "InvalidSwapDeadline");
            });
        });

        context("* Testing ownership and access control", async () => {
            it("Should set new owner", async () => {
                const { migrator, owner, user } = await loadFixture(setupTestEnvironment);
                const newOwner = user;
                await migrator.connect(owner).transferOwnership(newOwner.address);
                expect(await migrator.owner()).to.equal(newOwner.address);
            });

            it("Should revert if non-owner tries to set new owner", async () => {
                const { migrator, owner, user } = await loadFixture(setupTestEnvironment);
                const newOwner = user;
                await expect(migrator.connect(user).transferOwnership(newOwner.address))
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should set new adapter", async () => {
                const { migrator, owner, aaveV3UsdsAdapter, contractsFactory } = await loadFixture(
                    setupTestEnvironment
                );

                const newAdapter = await contractsFactory.AaveV3UsdsAdapterFactory.connect(owner).deploy({
                    uniswapRouter: aaveV3UsdsAdapter.UNISWAP_ROUTER(),
                    daiUsdsConverter: aaveV3UsdsAdapter.DAI_USDS_CONVERTER(),
                    dai: aaveV3UsdsAdapter.DAI(),
                    usds: aaveV3UsdsAdapter.USDS(),
                    aaveLendingPool: aaveV3UsdsAdapter.LENDING_POOL(),
                    aaveDataProvider: aaveV3UsdsAdapter.LENDING_POOL(),
                    isFullMigration: true,
                    useSwapRouter02: true
                });

                await expect(migrator.connect(owner).setAdapter(newAdapter.address))
                    .to.emit(migrator, "AdapterAllowed")
                    .withArgs(newAdapter.address);

                const adapters = await migrator.getAdapters();
                expect(adapters).to.include(newAdapter.address);
            });

            it("Should revert if non-owner tries to set new adapter", async () => {
                const { migrator, owner, user, aaveV3UsdsAdapter, contractsFactory } = await loadFixture(
                    setupTestEnvironment
                );

                const newAdapter = await contractsFactory.AaveV3UsdsAdapterFactory.connect(owner).deploy({
                    uniswapRouter: aaveV3UsdsAdapter.UNISWAP_ROUTER(),
                    daiUsdsConverter: aaveV3UsdsAdapter.DAI_USDS_CONVERTER(),
                    dai: aaveV3UsdsAdapter.DAI(),
                    usds: aaveV3UsdsAdapter.USDS(),
                    aaveLendingPool: aaveV3UsdsAdapter.LENDING_POOL(),
                    aaveDataProvider: aaveV3UsdsAdapter.LENDING_POOL(),
                    isFullMigration: true,
                    useSwapRouter02: true
                });

                await expect(migrator.connect(user).setAdapter(newAdapter.address))
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should revert if adapter is already added", async () => {
                const { migrator, owner, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(owner).setAdapter(aaveV3UsdsAdapter.address))
                    .to.be.revertedWithCustomError(migrator, "AdapterAlreadyAllowed")
                    .withArgs(aaveV3UsdsAdapter.address);
            });

            it("Should revert if adapter is zero address", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(owner).setAdapter(AddressZero)).to.be.revertedWithCustomError(
                    migrator,
                    "InvalidZeroAddress"
                );
            });

            it("Should remove adapter", async () => {
                const { migrator, owner, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                // Pause the contract before removing the adapter
                await migrator.connect(owner).pause();
                await expect(migrator.connect(owner).removeAdapter(aaveV3UsdsAdapter.address))
                    .to.emit(migrator, "AdapterRemoved")
                    .withArgs(aaveV3UsdsAdapter.address);

                const adapters = await migrator.getAdapters();
                expect(adapters).to.not.include(aaveV3UsdsAdapter.address);
            });

            it("Should revert if contract is not paused", async () => {
                const { migrator, owner, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(owner).removeAdapter(aaveV3UsdsAdapter.address))
                    .to.be.revertedWithCustomError(migrator, "ExpectedPause")
                    .withArgs();
            });

            it("Should revert if non-owner tries to remove adapter", async () => {
                const { migrator, user, aaveV3UsdsAdapter } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(user).removeAdapter(aaveV3UsdsAdapter.address))
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should revert if adapter is not added", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                // Pause the contract before removing the adapter
                await migrator.connect(owner).pause();
                const unknownAdapter = ethers.Wallet.createRandom().address;

                await expect(migrator.connect(owner).removeAdapter(unknownAdapter)).to.be.revertedWithCustomError(
                    migrator,
                    "InvalidAdapter"
                );
            });

            it.skip("Should set new flashData", async () => {
                const { migrator, owner, mocks } = await loadFixture(setupTestEnvironment);
                const newComet = ethers.Wallet.createRandom().address;

                const newFlashData = {
                    liquidityPool: mocks.uniswapV3PoolUsdsDai.address,
                    baseToken: mocks.mockUSDS.address,
                    isToken0: true
                };
                await expect(migrator.connect(owner).setFlashData(newComet, newFlashData))
                    .to.emit(migrator, "FlashDataConfigured")
                    .withArgs(newComet, newFlashData.liquidityPool, newFlashData.baseToken);

                const flashData = await migrator.getFlashData(newComet);
                expect(flashData.baseToken).to.equal(newFlashData.baseToken);
                expect(flashData.liquidityPool).to.equal(newFlashData.liquidityPool);
                expect(flashData.isToken0).to.equal(newFlashData.isToken0);
            });

            it("Should revert if non-owner tries to set new flashData", async () => {
                const { migrator, user, mocks } = await loadFixture(setupTestEnvironment);
                const newComet = ethers.Wallet.createRandom().address;

                const newFlashData = {
                    liquidityPool: mocks.uniswapV3PoolUsdsDai.address,
                    baseToken: mocks.mockUSDS.address,
                    isToken0: true
                };
                await expect(migrator.connect(user).setFlashData(newComet, newFlashData))
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should revert if flashData includes zero address", async () => {
                const { migrator, owner, mocks } = await loadFixture(setupTestEnvironment);
                const newComet = ethers.Wallet.createRandom().address;

                let newFlashData = {
                    liquidityPool: AddressZero,
                    baseToken: mocks.mockUSDS.address,
                    isToken0: true
                };
                await expect(
                    migrator.connect(owner).setFlashData(newComet, newFlashData)
                ).to.be.revertedWithCustomError(migrator, "InvalidZeroAddress");

                newFlashData = {
                    liquidityPool: mocks.uniswapV3PoolUsdsDai.address,
                    baseToken: AddressZero,
                    isToken0: true
                };
                await expect(
                    migrator.connect(owner).setFlashData(newComet, newFlashData)
                ).to.be.revertedWithCustomError(migrator, "InvalidZeroAddress");
            });

            it.skip("Should revert if flashData already configured for specific comet", async () => {
                const { migrator, owner, mocks } = await loadFixture(setupTestEnvironment);
                const newComet = ethers.Wallet.createRandom().address;

                const newFlashData = {
                    liquidityPool: mocks.uniswapV3PoolUsdsDai.address,
                    baseToken: mocks.mockUSDS.address,
                    isToken0: true
                };
                await migrator.connect(owner).setFlashData(newComet, newFlashData);

                await expect(migrator.connect(owner).setFlashData(newComet, newFlashData))
                    .to.be.revertedWithCustomError(migrator, "CometAlreadyConfigured")
                    .withArgs(newComet);
            });

            it("Should remove flashData", async () => {
                const { migrator, owner, mocks } = await loadFixture(setupTestEnvironment);
                const { mockCometUsds } = mocks;

                await expect(migrator.connect(owner).removeFlashData(mockCometUsds.address))
                    .to.emit(migrator, "FlashDataRemoved")
                    .withArgs(mockCometUsds.address);

                const flashData = await migrator.getFlashData(mockCometUsds.address);

                expect(flashData.baseToken).to.equal(AddressZero);
                expect(flashData.liquidityPool).to.equal(AddressZero);
                expect(flashData.isToken0).to.equal(false);
            });

            it("Should revert if non-owner tries to remove flashData", async () => {
                const { migrator, user, mocks } = await loadFixture(setupTestEnvironment);
                const { mockCometUsds } = mocks;

                await expect(migrator.connect(user).removeFlashData(mockCometUsds.address))
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should revert if flashData is not configured", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                const unknownComet = ethers.Wallet.createRandom().address;

                await expect(migrator.connect(owner).removeFlashData(unknownComet))
                    .to.be.revertedWithCustomError(migrator, "CometIsNotSupported")
                    .withArgs(unknownComet);
            });

            it("Should set contract on pause", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(owner).pause()).to.emit(migrator, "Paused").withArgs(owner.address);
                expect(await migrator.paused()).to.equal(true);
            });

            it("Should revert if non-owner tries to pause contract", async () => {
                const { migrator, user } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(user).pause())
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });

            it("Should set contract on unpause", async () => {
                const { migrator, owner } = await loadFixture(setupTestEnvironment);
                await migrator.connect(owner).pause();
                await expect(migrator.connect(owner).unpause()).to.emit(migrator, "Unpaused").withArgs(owner.address);
                expect(await migrator.paused()).to.equal(false);
            });

            it("Should revert if non-owner tries to unpause contract", async () => {
                const { migrator, user } = await loadFixture(setupTestEnvironment);
                await expect(migrator.connect(user).unpause())
                    .to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount")
                    .withArgs(user.address);
            });
        });

        context("* AaveV3 -> Comet | AaveV3UsdsAdapter", async () => {
            // collateral - WETH; borrow - USDS; comet - USDS.
            it("Should migrate a user's position successfully: convert and swap token", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - USDS
                const borrowAmounts = {
                    USDS: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.USDS.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowAave.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: convert and swap token", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    USDS: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.USDS.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowAave.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: convert and swap with proxy token", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                // await migrator.connect(user).removeFlashData

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // const supplyAmounts = Object.fromEntries(
                //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
                // );

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Aave - DAI
                const borrowAmounts = {
                    USDS: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = aaveContract.debtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: mocks.aaveContract.debtTokens.USDS.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    borrowAave: {
                        USDS: await mocks.aaveContract.debtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowAave.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: without borrow position | convert tokens", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    DAI: parseEther("700")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }
                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.DAI.address,
                            amount: parseEther("700"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsAave: {
                        DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: without borrow position |  without swap and convert", async () => {
                const { migrator, user, aaveV3UsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, aaveContract } = mocks;

                const aaveLendingPool = aaveContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("700")
                };

                // Setup for AaveV3 -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = aaveContract.aTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
                    await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }
                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const aTokenContract = aaveContract.aTokens[token];
                    await aTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            aToken: mocks.aaveContract.aTokens.WETH.address,
                            amount: parseEther("700"),
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
                    ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address),
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3UsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsAave: {
                        WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address),
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Aave
                expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
                expect(userBalancesAfter.collateralsComet.WETH).to.be.above(userBalancesBefore.collateralsComet.WETH);
            });
        });

        // context("* AaveV3 -> Comet | AaveV3Adapter", async () => {
        //     it("Should migrate a user's position successfully with: swap token", async () => {
        //         const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, aaveContract, mockWETH, mockCometUsdt } = mocks;

        //         const aaveLendingPool = aaveContract.lendingPools;

        //         const supplyAmounts = {
        //             WETH: parseEther("500")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // const supplyAmounts = Object.fromEntries(
        //         //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
        //         // );

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = aaveContract.aTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
        //             await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Borrow from Aave - DAI
        //         const borrowAmounts = {
        //             DAI: parseEther("100")
        //         };

        //         for (const [token, amount] of Object.entries(borrowAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const debtTokenContract = aaveContract.debtTokens[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Init migration
        //         // Approve migration

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = aaveContract.aTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [
        //                 {
        //                     debtToken: aaveContract.debtTokens.DAI.address,
        //                     amount: MaxUint256,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountInMaximum: parseEther("100")
        //                     }
        //                 }
        //             ],

        //             collaterals: [
        //                 {
        //                     aToken: aaveContract.aTokens.WETH.address,
        //                     amount: parseEther("500"),
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsAave: {
        //                 WETH: await aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowAave: {
        //                 DAI: await aaveContract.debtTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = parseEther("500");

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(aaveV3Adapter.address, mocks.mockCometUsdt.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsAave: {
        //                 WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowAave: {
        //                 DAI: await mocks.aaveContract.debtTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mocks.mockCometUsdt.collateralBalanceOf(user.address, mocks.mockWETH.address),
        //                 USDT: await mocks.mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Aave
        //         expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
        //         expect(userBalancesAfter.borrowAave.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
        //         expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
        //     });

        //     it("Should migrate a user's position successfully: swap only collateral position", async () => {
        //         const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, aaveContract, mockCometUsdt, mockWETH } = mocks;

        //         const aaveLendingPool = aaveContract.lendingPools;

        //         const supplyAmounts = {
        //             WETH: parseEther("500")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = aaveContract.aTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
        //             await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Borrow from Aave - USDT
        //         const borrowAmounts = {
        //             USDT: parseEther("100")
        //         };

        //         for (const [token, amount] of Object.entries(borrowAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const debtTokenContract = aaveContract.debtTokens[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             await aaveLendingPool.connect(user).borrow(tokenContract.address, amount);

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Init migration
        //         // Approve migration

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = aaveContract.aTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [
        //                 {
        //                     debtToken: aaveContract.debtTokens.USDT.address,
        //                     amount: parseEther("100"),
        //                     swapParams: {
        //                         path: "0x",
        //                         deadline,
        //                         amountInMaximum: parseEther("100")
        //                     }
        //                 }
        //             ],

        //             collaterals: [
        //                 {
        //                     aToken: aaveContract.aTokens.WETH.address,
        //                     amount: MaxUint256,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsAave: {
        //                 WETH: await aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowAave: {
        //                 USDT: await aaveContract.debtTokens.USDT.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = parseEther("100");

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(aaveV3Adapter.address, mockCometUsdt.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsAave: {
        //                 WETH: await aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowAave: {
        //                 USDT: await aaveContract.debtTokens.USDT.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Aave
        //         expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
        //         expect(userBalancesAfter.borrowAave.USDT).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
        //         expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
        //     });

        //     it("Should migrate a user's position successfully: without borrow position | convert tokens", async () => {
        //         const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, aaveContract } = mocks;

        //         const aaveLendingPool = aaveContract.lendingPools;

        //         const supplyAmounts = {
        //             DAI: parseEther("700")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = aaveContract.aTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
        //             await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }
        //         // Init migration
        //         // Approve migration
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = aaveContract.aTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     aToken: mocks.aaveContract.aTokens.DAI.address,
        //                     amount: parseEther("700"),
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
        //                             ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsAave: {
        //                 DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(aaveV3Adapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsAave: {
        //                 DAI: await mocks.aaveContract.aTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Aave
        //         expect(userBalancesAfter.collateralsAave.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
        //     });

        //     it("Should migrate a user's position successfully: without borrow position |  without swap and convert", async () => {
        //         const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, aaveContract } = mocks;

        //         const aaveLendingPool = aaveContract.lendingPools;

        //         const supplyAmounts = {
        //             WETH: parseEther("700")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = aaveContract.aTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(aaveLendingPool.address, amount);
        //             await aaveLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }
        //         // Init migration
        //         // Approve migration
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = aaveContract.aTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     aToken: mocks.aaveContract.aTokens.WETH.address,
        //                     amount: parseEther("700"),
        //                     swapParams: {
        //                         path: "0x",
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsAave: {
        //                 WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address),
        //                 WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(aaveV3Adapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsAave: {
        //                 WETH: await mocks.aaveContract.aTokens.WETH.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address),
        //                 WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Aave
        //         expect(userBalancesAfter.collateralsAave.WETH).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
        //         expect(userBalancesAfter.collateralsComet.WETH).to.be.above(userBalancesBefore.collateralsComet.WETH);
        //     });
        // });

        context("* Spark -> Comet | sparkUsdsAdapter", async () => {
            // collateral - WETH; borrow - DAI; comet - USDT.
            it("Should migrate a user's position successfully: swap collateral and borrow positions", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsdt } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for Spark -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = sparkContract.spTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Spark - DAI
                const borrowAmounts = {
                    DAI: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = sparkContract.spDebtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: sparkContract.spDebtTokens.DAI.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowSpark.DAI).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
            });

            // collateral - WETH; borrow - DAI; comet - USDT.
            it("Should migrate a user's position successfully: swap only collateral position", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsdt } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for Spark -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = sparkContract.spTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Spark - USDT
                const borrowAmounts = {
                    USDT: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = sparkContract.spDebtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: sparkContract.spDebtTokens.USDT.address,
                            amount: MaxUint256,
                            swapParams: {
                                path: "0x",
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        USDT: await sparkContract.spDebtTokens.USDT.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("100");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        USDT: await sparkContract.spDebtTokens.USDT.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowSpark.USDT).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
            });

            it("Should migrate a user's position successfully: convert and swap with proxy token", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsds } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    WETH: parseEther("500")
                };

                // Setup for Spark -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const aTokenContract = sparkContract.spTokens[token];
                    expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Aave
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Borrow from Spark - DAI
                const borrowAmounts = {
                    USDS: parseEther("100")
                };

                for (const [token, amount] of Object.entries(borrowAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const debtTokenContract = sparkContract.spDebtTokens[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

                    await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                    expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
                }

                // Init migration
                // Approve migration

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            debtToken: sparkContract.spDebtTokens.USDS.address,
                            amount: parseEther("100"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: parseEther("100")
                            }
                        }
                    ],

                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.WETH.address,
                            amount: parseEther("500"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        USDS: await sparkContract.spDebtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("500");

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsSpark: {
                        WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
                    },
                    borrowSpark: {
                        USDS: await sparkContract.spDebtTokens.USDS.balanceOf(user.address)
                    },
                    collateralsComet: {
                        WETH: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.WETH.address),
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowSpark.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: without borrow position | convert tokens", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsds } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    DAI: parseEther("700")
                };

                // Setup for Spark -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const spTokenContract = sparkContract.spTokens[token];
                    expect(await spTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Spark
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await spTokenContract.balanceOf(user.address)).to.equal(amount);
                }
                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.DAI.address,
                            amount: parseEther("700"),
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsSpark: {
                        DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.DAI).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully: without borrow position |  without swap and convert", async () => {
                const { migrator, user, sparkUsdsAdapter, mocks } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, sparkContract, mockCometUsds } = mocks;

                const sparkLendingPool = sparkContract.lendingPools;

                const supplyAmounts = {
                    DAI: parseEther("700")
                };

                // Setup for Spark -> Comet migration
                // Fund user with tokens
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(amount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: amount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
                }

                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const tokenContract = tokenContracts[token];
                    const spTokenContract = sparkContract.spTokens[token];
                    expect(await spTokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Approve token and deposit to Spark
                    await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
                    await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

                    expect(await spTokenContract.balanceOf(user.address)).to.equal(amount);
                }
                // Init migration
                // Approve migration
                for (const [token, amount] of Object.entries(supplyAmounts)) {
                    const spTokenContract = sparkContract.spTokens[token];
                    await spTokenContract.connect(user).approve(migrator.address, amount);
                }

                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            spToken: sparkContract.spTokens.DAI.address,
                            amount: parseEther("700"),
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
                    ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralsSpark: {
                        DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address),
                        DAI: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.DAI.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralsSpark: {
                        DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address),
                        DAI: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.DAI.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Spark
                expect(userBalancesAfter.collateralsSpark.DAI).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
                expect(userBalancesAfter.collateralsComet.DAI).to.be.above(userBalancesBefore.collateralsComet.DAI);
            });
        });
        // context("* Spark -> Comet | sparkAdapter", async () => {
        //     // collateral - WETH; borrow - DAI; comet - USDT.
        //     it("Should migrate a user's position successfully: swap collateral and borrow position", async () => {
        //         const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, sparkContract, mockCometUsdt } = mocks;

        //         const sparkLendingPool = sparkContract.lendingPools;

        //         const supplyAmounts = {
        //             WETH: parseEther("500")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // const supplyAmounts = Object.fromEntries(
        //         //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
        //         // );

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = sparkContract.spTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
        //             await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Borrow from Aave - DAI
        //         const borrowAmounts = {
        //             DAI: parseEther("100")
        //         };

        //         for (const [token, amount] of Object.entries(borrowAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const debtTokenContract = sparkContract.spDebtTokens[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Init migration
        //         // Approve migration

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = sparkContract.spTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [
        //                 {
        //                     debtToken: sparkContract.spDebtTokens.DAI.address,
        //                     amount: MaxUint256,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountInMaximum: parseEther("100")
        //                     }
        //                 }
        //             ],

        //             collaterals: [
        //                 {
        //                     aToken: sparkContract.spTokens.WETH.address,
        //                     amount: parseEther("500"),
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsSpark: {
        //                 WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowSpark: {
        //                 DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = parseEther("500");

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(sparkAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsSpark: {
        //                 WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowSpark: {
        //                 DAI: await sparkContract.spDebtTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Spark
        //         expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(Zero);
        //         expect(userBalancesAfter.borrowSpark.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
        //         expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
        //     });

        //     it("Should migrate a user's position successfully: swap only collateral position", async () => {
        //         const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, sparkContract, mockCometUsdt } = mocks;

        //         const sparkLendingPool = sparkContract.lendingPools;

        //         const supplyAmounts = {
        //             WETH: parseEther("500")
        //         };

        //         // Setup for AaveV3 -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // const supplyAmounts = Object.fromEntries(
        //         //     Object.entries(fundingData).map(([token, amount]) => [token, amount])
        //         // );

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const aTokenContract = sparkContract.spTokens[token];
        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Aave
        //             await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
        //             await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await aTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Borrow from Aave - USDT
        //         const borrowAmounts = {
        //             USDT: parseEther("100")
        //         };

        //         for (const [token, amount] of Object.entries(borrowAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const debtTokenContract = sparkContract.spDebtTokens[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             await sparkLendingPool.connect(user).borrow(tokenContract.address, amount);

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //             expect(await debtTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         // Init migration
        //         // Approve migration

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const aTokenContract = sparkContract.spTokens[token];
        //             await aTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [
        //                 {
        //                     debtToken: sparkContract.spDebtTokens.USDT.address,
        //                     amount: MaxUint256,
        //                     swapParams: {
        //                         path: "0x",
        //                         deadline,
        //                         amountInMaximum: parseEther("100")
        //                     }
        //                 }
        //             ],

        //             collaterals: [
        //                 {
        //                     aToken: sparkContract.spTokens.WETH.address,
        //                     amount: parseEther("500"),
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_AAVE_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsSpark: {
        //                 WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowSpark: {
        //                 USDS: await sparkContract.spDebtTokens.USDS.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = parseEther("500");

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(sparkAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsSpark: {
        //                 WETH: await sparkContract.spTokens.WETH.balanceOf(user.address)
        //             },
        //             borrowSpark: {
        //                 USDS: await sparkContract.spDebtTokens.USDS.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, tokenContracts.WETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Spark
        //         expect(userBalancesAfter.collateralsSpark.WETH).to.be.equal(Zero);
        //         expect(userBalancesAfter.borrowSpark.USDS).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.WETH).to.be.equal(userBalancesBefore.collateralsComet.WETH);
        //         expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
        //     });

        //     it("Should migrate a user's position successfully: without borrow position | convert collateral", async () => {
        //         const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, sparkContract, mockCometUsds } = mocks;

        //         const sparkLendingPool = sparkContract.lendingPools;

        //         const supplyAmounts = {
        //             DAI: parseEther("700")
        //         };

        //         // Setup for Spark -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const spTokenContract = sparkContract.spTokens[token];
        //             expect(await spTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Spark
        //             await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
        //             await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await spTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }
        //         // Init migration
        //         // Approve migration
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const spTokenContract = sparkContract.spTokens[token];
        //             await spTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     spToken: sparkContract.spTokens.DAI.address,
        //                     amount: parseEther("700"),
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20),
        //                             ethers.utils.hexZeroPad(mocks.tokenContracts.USDS.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsSpark: {
        //                 DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(sparkAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsSpark: {
        //                 DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Spark
        //         expect(userBalancesAfter.collateralsSpark.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
        //     });

        //     it("Should migrate a user's position successfully: without borrow position |  without swap and convert", async () => {
        //         const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, sparkContract, mockCometUsds } = mocks;

        //         const sparkLendingPool = sparkContract.lendingPools;

        //         const supplyAmounts = {
        //             DAI: parseEther("700")
        //         };

        //         // Setup for Spark -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(amount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: amount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(amount);
        //         }

        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const tokenContract = tokenContracts[token];
        //             const spTokenContract = sparkContract.spTokens[token];
        //             expect(await spTokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Approve token and deposit to Spark
        //             await tokenContract.connect(user).approve(sparkLendingPool.address, amount);
        //             await sparkLendingPool.connect(user).deposit(tokenContract.address, amount);

        //             expect(await spTokenContract.balanceOf(user.address)).to.equal(amount);
        //         }
        //         // Init migration
        //         // Approve migration
        //         for (const [token, amount] of Object.entries(supplyAmounts)) {
        //             const spTokenContract = sparkContract.spTokens[token];
        //             await spTokenContract.connect(user).approve(migrator.address, amount);
        //         }

        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     spToken: sparkContract.spTokens.DAI.address,
        //                     amount: parseEther("700"),
        //                     swapParams: {
        //                         path: "0x",
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_SPARK_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralsSpark: {
        //                 DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address),
        //                 DAI: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.DAI.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;

        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(sparkAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralsSpark: {
        //                 DAI: await sparkContract.spTokens.DAI.balanceOf(user.address)
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address),
        //                 DAI: await mockCometUsds.collateralBalanceOf(user.address, tokenContracts.DAI.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Spark
        //         expect(userBalancesAfter.collateralsSpark.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.equal(userBalancesBefore.collateralsComet.USDS);
        //         expect(userBalancesAfter.collateralsComet.DAI).to.be.above(userBalancesBefore.collateralsComet.DAI);
        //     });
        // });

        context("* Morpho -> Comet | morphoUsdsAdapter", async () => {
            it("Should migrate a user's position successfully: with swap position", async function () {
                const { migrator, user, mocks, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, mockCometUsdt, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

                const supplyData = {
                    WETH: { market: "USDS_WETH", supplyAmount: parseEther("500") }
                };

                // Setup for Morpho -> Comet migration
                // Fund user with tokens
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(data.supplyAmount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: data.supplyAmount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
                }

                // Supply collateral to Morpho
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.market];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

                    await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

                    await mockMorpho
                        .connect(user)
                        .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                }

                const borrowAData = {
                    USDS: { marketId: "USDS_WETH", borrowAmount: parseEther("100") }
                };

                for (const [token, data] of Object.entries(borrowAData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.marketId];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Borrow from Morpho
                    await mocks.mockMorpho
                        .connect(user)
                        .borrow(marketParams, data.borrowAmount, 0, user.address, user.address);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.borrowAmount);
                }

                // Create migration position
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            marketId: morphoMarketIds.USDS_WETH,
                            assetsAmount: borrowAData.USDS.borrowAmount,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: borrowAData.USDS.borrowAmount
                            }
                        }
                    ],
                    collaterals: [
                        {
                            marketId: morphoMarketIds.USDS_WETH,
                            assetsAmount: supplyData.WETH.supplyAmount,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralMorpho: {
                        WETH: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).collateral
                    },
                    borrowMorpho: {
                        USDS: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).borrowShares
                    },
                    collateralsComet: {
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("100");

                // Execute migration
                await expect(
                    migrator
                        .connect(user)
                        .migrate(morphoUsdsAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralMorpho: {
                        WETH: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).collateral
                    },
                    borrowMorpho: {
                        USDS: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).borrowShares
                    },
                    collateralsComet: {
                        USDT: await mockCometUsdt.balanceOf(user.address)
                    }
                };
                logger("\nuserBalancesAfter", userBalancesAfter);
                // Check user balances after migration - Morpho
                expect(userBalancesAfter.collateralMorpho.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowMorpho.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
            });

            it("Should migrate a user's position successfully with: swap with proxy token", async function () {
                const { migrator, user, mocks, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

                const supplyData = {
                    WETH: { market: "USDT_WETH", supplyAmount: parseEther("500") }
                };

                // Setup for Morpho -> Comet migration
                // Fund user with tokens
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(data.supplyAmount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: data.supplyAmount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
                }

                // Supply collateral to Morpho
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.market];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

                    await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

                    await mockMorpho
                        .connect(user)
                        .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                }

                const borrowAData = {
                    USDT: { marketId: "USDT_WETH", borrowAmount: parseEther("100") }
                };

                for (const [token, data] of Object.entries(borrowAData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.marketId];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    // Borrow from Morpho
                    await mockMorpho
                        .connect(user)
                        .borrow(marketParams, data.borrowAmount, 0, user.address, user.address);

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.borrowAmount);
                }

                // Create migration position
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [
                        {
                            marketId: morphoMarketIds.USDT_WETH,
                            assetsAmount: borrowAData.USDT.borrowAmount,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.USDT.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(mocks.tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountInMaximum: borrowAData.USDT.borrowAmount
                            }
                        }
                    ],
                    collaterals: [
                        {
                            marketId: morphoMarketIds.USDT_WETH,
                            assetsAmount: supplyData.WETH.supplyAmount,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
                                    FEE_100,
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralMorpho: {
                        WETH: (await mockMorpho.position(morphoMarketIds.USDT_WETH, user.address)).collateral
                    },
                    borrowMorpho: {
                        USDT: (await mockMorpho.position(morphoMarketIds.USDT_WETH, user.address)).borrowShares
                    },
                    collateralsComet: {
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = parseEther("100");

                // Execute migration
                await expect(
                    migrator
                        .connect(user)
                        .migrate(morphoUsdsAdapter.address, mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralMorpho: {
                        WETH: (await mockMorpho.position(morphoMarketIds.USDT_WETH, user.address)).collateral
                    },
                    borrowMorpho: {
                        USDT: (await mockMorpho.position(morphoMarketIds.USDT_WETH, user.address)).borrowShares
                    },
                    collateralsComet: {
                        USDS: await mockCometUsds.balanceOf(user.address)
                    }
                };
                logger("\nuserBalancesAfter", userBalancesAfter);

                // Check user balances after migration - Morpho
                expect(userBalancesAfter.collateralMorpho.WETH).to.be.equal(Zero);
                expect(userBalancesAfter.borrowMorpho.USDT).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });

            it("Should migrate a user's position successfully with: without borrow position | convert tokens", async function () {
                const { migrator, user, mocks, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

                const supplyData = {
                    DAI: { market: "USDT_DAI", supplyAmount: parseEther("500") }
                };

                // Setup for Morpho -> Comet migration
                // Fund user with tokens
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(data.supplyAmount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: data.supplyAmount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
                }

                // Supply collateral to Morpho
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.market];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

                    await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

                    await mockMorpho
                        .connect(user)
                        .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                }

                // Create migration position
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            marketId: morphoMarketIds.USDT_DAI,
                            assetsAmount: supplyData.DAI.supplyAmount,
                            swapParams: {
                                path: ethers.utils.concat([
                                    ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
                                    ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20)
                                ]),
                                deadline,
                                amountOutMinimum: 1n
                            }
                        }
                    ]
                };

                // Encode the data
                const migrationData = ethers.utils.defaultAbiCoder.encode(
                    ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralMorpho: {
                        DAI: (await mocks.mockMorpho.position(morphoMarketIds.USDT_DAI, user.address)).collateral
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesAfter", userBalancesBefore);

                const flashAmount = Zero;

                // Execute migration
                await expect(
                    migrator
                        .connect(user)
                        .migrate(morphoUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralMorpho: {
                        DAI: (await mocks.mockMorpho.position(morphoMarketIds.USDT_DAI, user.address)).collateral
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                // Check user balances after migration - Morpho
                expect(userBalancesAfter.collateralMorpho.DAI).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });
            it("Should migrate a user's position successfully with: without borrow position |  without swap and convert", async function () {
                const { migrator, user, mocks, morphoUsdsAdapter } = await loadFixture(setupTestEnvironment);
                const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

                const supplyData = {
                    USDS: { market: "DAI_USDS", supplyAmount: parseEther("500") }
                };

                // Setup for Morpho -> Comet migration
                // Fund user with tokens
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

                    if ("mint" in tokenContract) {
                        await tokenContract.connect(user).mint(data.supplyAmount);
                    } else {
                        await tokenContract.connect(user).deposit({ value: data.supplyAmount });
                    }

                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
                }

                // Supply collateral to Morpho
                for (const [token, data] of Object.entries(supplyData)) {
                    const tokenContract = tokenContracts[token];
                    const marketParams = morphoMarketParams[data.market];
                    expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

                    await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

                    await mockMorpho
                        .connect(user)
                        .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

                    expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
                }

                // Create migration position
                const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

                const position = {
                    borrows: [],
                    collaterals: [
                        {
                            marketId: morphoMarketIds.DAI_USDS,
                            assetsAmount: supplyData.USDS.supplyAmount,
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
                    ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
                    [[position.borrows, position.collaterals]]
                );

                const userBalancesBefore = {
                    collateralMorpho: {
                        USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
                    },
                    collateralsComet: {
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                logger("\nuserBalancesBefore", userBalancesBefore);

                const flashAmount = Zero;

                // Execute migration
                await expect(
                    migrator
                        .connect(user)
                        .migrate(morphoUsdsAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userBalancesAfter = {
                    collateralMorpho: {
                        USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
                    },
                    collateralsComet: {
                        WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
                        USDS: await mocks.mockCometUsds.balanceOf(user.address)
                    }
                };

                // Check user balances after migration - Morpho
                expect(userBalancesAfter.collateralMorpho.USDS).to.be.equal(Zero);
                // Check user balances after migration - Comet
                expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
            });
        });
        // context("* Morpho -> Comet | morphoAdapter", async () => {
        //     it("Should migrate a user's position successfully with: swap collateral and borrow position", async function () {
        //         const { migrator, user, mocks, morphoAdapter } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, mockCometUsdt, mockMorpho, morphoMarketParams, morphoMarketIds, mockWETH } =
        //             mocks;

        //         const supplyData = {
        //             WETH: { market: "USDS_WETH", supplyAmount: parseEther("500") }
        //         };

        //         // Setup for Morpho -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(data.supplyAmount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: data.supplyAmount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
        //         }

        //         // Supply collateral to Morpho
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             const marketParams = morphoMarketParams[data.market];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

        //             await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

        //             await mockMorpho
        //                 .connect(user)
        //                 .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //         }

        //         const borrowAData = {
        //             USDS: { marketId: "USDS_WETH", borrowAmount: parseEther("100") }
        //         };

        //         for (const [token, data] of Object.entries(borrowAData)) {
        //             const tokenContract = tokenContracts[token];
        //             const marketParams = morphoMarketParams[data.marketId];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             // Borrow from Morpho
        //             await mockMorpho
        //                 .connect(user)
        //                 .borrow(marketParams, data.borrowAmount, 0, user.address, user.address);

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.borrowAmount);
        //         }

        //         // Create migration position
        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [
        //                 {
        //                     marketId: morphoMarketIds.USDS_WETH,
        //                     assetsAmount: borrowAData.USDS.borrowAmount,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountInMaximum: borrowAData.USDS.borrowAmount
        //                     }
        //                 }
        //             ],
        //             collaterals: [
        //                 {
        //                     marketId: morphoMarketIds.USDS_WETH,
        //                     assetsAmount: supplyData.WETH.supplyAmount,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.WETH.address, 20),
        //                             FEE_100,
        //                             ethers.utils.hexZeroPad(tokenContracts.USDT.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralMorpho: {
        //                 WETH: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).collateral
        //             },
        //             borrowMorpho: {
        //                 USDS: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).borrowShares
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesBefore", userBalancesBefore);

        //         const flashAmount = parseEther("100");

        //         // Execute migration
        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(morphoAdapter.address, mockCometUsdt.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralMorpho: {
        //                 WETH: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).collateral
        //             },
        //             borrowMorpho: {
        //                 USDS: (await mockMorpho.position(morphoMarketIds.USDS_WETH, user.address)).borrowShares
        //             },
        //             collateralsComet: {
        //                 WETH: await mockCometUsdt.collateralBalanceOf(user.address, mockWETH.address),
        //                 USDT: await mockCometUsdt.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesAfter);

        //         // Check user balances after migration - Morpho
        //         expect(userBalancesAfter.collateralMorpho.WETH).to.be.equal(Zero);
        //         expect(userBalancesAfter.borrowMorpho.USDS).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDT).to.be.above(userBalancesBefore.collateralsComet.USDT);
        //     });
        //     it("Should migrate a user's position successfully: without borrow position | convert tokens", async function () {
        //         const { migrator, user, mocks, morphoAdapter } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

        //         const supplyData = {
        //             DAI: { market: "USDT_DAI", supplyAmount: parseEther("500") }
        //         };

        //         // Setup for Morpho -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(data.supplyAmount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: data.supplyAmount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
        //         }

        //         // Supply collateral to Morpho
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             const marketParams = morphoMarketParams[data.market];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

        //             await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

        //             await mockMorpho
        //                 .connect(user)
        //                 .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //         }

        //         // Create migration position
        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     marketId: morphoMarketIds.USDT_DAI,
        //                     assetsAmount: supplyData.DAI.supplyAmount,
        //                     swapParams: {
        //                         path: ethers.utils.concat([
        //                             ethers.utils.hexZeroPad(tokenContracts.DAI.address, 20),
        //                             ethers.utils.hexZeroPad(tokenContracts.USDS.address, 20)
        //                         ]),
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralMorpho: {
        //                 DAI: (await mocks.mockMorpho.position(morphoMarketIds.USDT_DAI, user.address)).collateral
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;
        //         // Execute migration
        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(morphoAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralMorpho: {
        //                 DAI: (await mocks.mockMorpho.position(morphoMarketIds.USDT_DAI, user.address)).collateral
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         // Check user balances after migration - Morpho
        //         expect(userBalancesAfter.collateralMorpho.DAI).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
        //     });
        //     it("Should migrate a user's position successfully with: without borrow position |  without swap and convert", async function () {
        //         const { migrator, user, mocks, morphoAdapter } = await loadFixture(setupTestEnvironment);
        //         const { tokenContracts, mockCometUsds, mockMorpho, morphoMarketParams, morphoMarketIds } = mocks;

        //         const supplyData = {
        //             USDS: { market: "DAI_USDS", supplyAmount: parseEther("500") }
        //         };

        //         // Setup for Morpho -> Comet migration
        //         // Fund user with tokens
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);

        //             if ("mint" in tokenContract) {
        //                 await tokenContract.connect(user).mint(data.supplyAmount);
        //             } else {
        //                 await tokenContract.connect(user).deposit({ value: data.supplyAmount });
        //             }

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);
        //         }

        //         // Supply collateral to Morpho
        //         for (const [token, data] of Object.entries(supplyData)) {
        //             const tokenContract = tokenContracts[token];
        //             const marketParams = morphoMarketParams[data.market];
        //             expect(await tokenContract.balanceOf(user.address)).to.equal(data.supplyAmount);

        //             await tokenContract.connect(user).approve(mockMorpho.address, data.supplyAmount);

        //             await mockMorpho
        //                 .connect(user)
        //                 .supplyCollateral(marketParams, data.supplyAmount, user.address, "0x");

        //             expect(await tokenContract.balanceOf(user.address)).to.equal(Zero);
        //         }

        //         // Create migration position
        //         const deadline = await ethers.provider.getBlock("latest").then((block) => block.timestamp + 1000);

        //         const position = {
        //             borrows: [],
        //             collaterals: [
        //                 {
        //                     marketId: morphoMarketIds.DAI_USDS,
        //                     assetsAmount: supplyData.USDS.supplyAmount,
        //                     swapParams: {
        //                         path: "0x",
        //                         deadline,
        //                         amountOutMinimum: 1n
        //                     }
        //                 }
        //             ]
        //         };

        //         // Encode the data
        //         const migrationData = ethers.utils.defaultAbiCoder.encode(
        //             ["tuple(" + POSITION_MORPHO_ABI.join(",") + ")"],
        //             [[position.borrows, position.collaterals]]
        //         );

        //         const userBalancesBefore = {
        //             collateralMorpho: {
        //                 USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
        //             },
        //             collateralsComet: {
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         logger("\nuserBalancesAfter", userBalancesBefore);

        //         const flashAmount = Zero;
        //         // Execute migration
        //         await expect(
        //             migrator
        //                 .connect(user)
        //                 .migrate(morphoAdapter.address, mocks.mockCometUsds.address, migrationData, flashAmount)
        //         ).to.emit(migrator, "MigrationExecuted");

        //         const userBalancesAfter = {
        //             collateralMorpho: {
        //                 USDS: (await mocks.mockMorpho.position(morphoMarketIds.DAI_USDS, user.address)).collateral
        //             },
        //             collateralsComet: {
        //                 WETH: await mocks.mockCometUsds.collateralBalanceOf(user.address, mocks.mockWETH.address),
        //                 USDS: await mocks.mockCometUsds.balanceOf(user.address)
        //             }
        //         };

        //         // Check user balances after migration - Morpho
        //         expect(userBalancesAfter.collateralMorpho.USDS).to.be.equal(Zero);
        //         // Check user balances after migration - Comet
        //         expect(userBalancesAfter.collateralsComet.USDS).to.be.above(userBalancesBefore.collateralsComet.USDS);
        //     });
        // });
    });
});
