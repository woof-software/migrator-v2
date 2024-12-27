import { loadFixture, ethers, expect, parseEther, Zero, AddressZero } from "../helpers"; // Adjust the path as needed

import type {
    MigratorV2,
    AaveV3Adapter,
    SparkAdapter,
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
    MockERC20
} from "../../typechain-types";

const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

describe("MigratorV2AndAaveV3", function () {
    // Setup Mocks: deploy all necessary mock contracts
    async function setupMocks() {
        const [deployer] = await ethers.getSigners();
        // Deploy tokens
        // Deploy mock DAI
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockDAI = await MockERC20.deploy("Mock DAI", "DAI", parseEther("1000000"), deployer.address);
        await mockDAI.deployed();
        // Deploy mock USDS
        const mockUSDS = await MockERC20.deploy("Mock USDS", "mUSDS", parseEther("1000000"), deployer.address);
        await mockUSDS.deployed();
        // Deploy mock WETH9
        const MockWETH9 = await ethers.getContractFactory("MockWETH9");
        const mockWETH9 = await MockWETH9.deploy("Mock WETH", "WETH");
        await mockWETH9.deployed();

        // Deploy mock DaiUsds converter
        const MockDaiUsds = await ethers.getContractFactory("MockDaiUsds");
        const mockDaiUsds = await MockDaiUsds.deploy(mockDAI.address, mockUSDS.address);
        await mockDaiUsds.deployed();

        // Deploy mock Comet
        const MockComet = await ethers.getContractFactory("MockComet");
        const mockComet = await MockComet.deploy(mockUSDS.address, mockWETH9.address);
        await mockComet.deployed();

        // Deploy mock Aave Lending Pool with mock AToken and mock Debt Token
        // Deploy mock Aave Token
        const MockAToken = await ethers.getContractFactory("MockAToken");
        const mockAToken = await MockAToken.deploy("Mock WETH AToken", "aWETH", NATIVE_TOKEN_ADDRESS);
        await mockAToken.deployed();
        // Deploy mock Aave Debt Token
        const MockADebtToken = await ethers.getContractFactory("MockADebtToken");
        const mockADebtToken = await MockADebtToken.deploy("Mock DAI ADebtToken", "aDebtDAI", mockDAI.address);
        await mockADebtToken.deployed();
        // Deploy Aave Pool
        const MockAaveLendingPool = await ethers.getContractFactory("MockAavePool");
        const mockAavePool = await MockAaveLendingPool.deploy(mockAToken.address, mockADebtToken.address);
        await mockAavePool.deployed();

        // Deploy mock Spark Lending Pool with mock Spark Token and mock Debt Token
        // Deploy Spark Token
        const MockSpToken = await ethers.getContractFactory("MockSpToken");
        const mockSpToken = await MockSpToken.deploy("Mock WETH spToken", "spWETH", NATIVE_TOKEN_ADDRESS);
        await mockSpToken.deployed();
        // Deploy Spark Debt Token
        const MockSpDebtToken = await ethers.getContractFactory("MockSpDebtToken");
        const mockSpDebtToken = await MockSpDebtToken.deploy("Mock DAI SpDebtToken", "spDebtDAI", mockDAI.address);
        await mockSpDebtToken.deployed();
        // Deploy Spark Pool
        const MockSparkPool = await ethers.getContractFactory("MockSparkPool");
        const mockSparkPool = await MockSparkPool.deploy(mockSpToken.address, mockSpDebtToken.address);
        await mockSparkPool.deployed();

        // Deploy mock Uniswap V3 Pool for flash loans
        const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
        const mockUniswapV3Pool = await MockUniswapV3Pool.deploy(mockUSDS.address, mockDAI.address);
        await mockUniswapV3Pool.deployed();
        // Deploy mock Swap Router
        const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
        const mockSwapRouter = await MockSwapRouter.deploy();
        await mockSwapRouter.deployed();
        // Initial financing of contracts
        // Fund Swap Router
        await mockDAI.transfer(mockSwapRouter.address, parseEther("2000"));
        await mockUSDS.transfer(mockSwapRouter.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockSwapRouter.address,
            value: parseEther("2000")
        });
        // Fund Uniswap V3 Pool
        await mockDAI.transfer(mockUniswapV3Pool.address, parseEther("2000"));
        await mockUSDS.transfer(mockUniswapV3Pool.address, parseEther("2000"));
        await mockWETH9.transfer(mockUniswapV3Pool.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockUniswapV3Pool.address,
            value: parseEther("2000")
        });
        // Fund Aave Lending Pool
        await mockDAI.transfer(mockAavePool.address, parseEther("2000"));
        await mockUSDS.transfer(mockAavePool.address, parseEther("2000"));
        await mockWETH9.transfer(mockAavePool.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockAavePool.address,
            value: parseEther("2000")
        });
        // Fund Spark Lending Pool
        await mockDAI.transfer(mockSparkPool.address, parseEther("2000"));
        await mockUSDS.transfer(mockSparkPool.address, parseEther("2000"));
        await mockWETH9.transfer(mockSparkPool.address, parseEther("2000"));
        await deployer.sendTransaction({
            to: mockSparkPool.address,
            value: parseEther("2000")
        });
        // Fund Converter (DaiUsds)
        await mockDAI.transfer(mockDaiUsds.address, parseEther("2000"));
        await mockUSDS.transfer(mockDaiUsds.address, parseEther("2000"));
        // Fund Comet
        await mockUSDS.transfer(mockComet.address, parseEther("2000"));

        return {
            deployer,
            // tokens
            mockDAI,
            mockUSDS,
            mockWETH9,
            // Aave
            mockAavePool,
            mockAToken,
            mockADebtToken,
            // Spark
            mockSparkPool,
            mockSpToken,
            mockSpDebtToken,
            // other
            mockDaiUsds,
            mockComet,
            mockUniswapV3Pool,
            mockSwapRouter
        };
    }

    // async function setupSparkMocks() {
    //     const [deployer] = await ethers.getSigners();
    //     // Deploy tokens
    //     const MockERC20 = await ethers.getContractFactory("MockERC20");
    //     const mockDAI = await MockERC20.deploy("Mock DAI", "DAI", parseEther("1000000"), deployer.address);
    //     await mockDAI.deployed();

    //     const mockUSDS = await MockERC20.deploy("Mock USDS", "mUSDS", parseEther("1000000"), deployer.address);
    //     await mockUSDS.deployed();

    //     const MockWETH9 = await ethers.getContractFactory("MockWETH9");
    //     const mockWETH9 = await MockWETH9.deploy("Mock WETH", "WETH");
    //     await mockWETH9.deployed();

    //     const MockSpToken = await ethers.getContractFactory("MockAToken");
    //     const mockSpToken = await MockSpToken.deploy("Mock WETH spToken", "spWETH", NATIVE_TOKEN_ADDRESS);
    //     await mockSpToken.deployed();

    //     const MockSpDebtToken = await ethers.getContractFactory("MockADebtToken");
    //     const mockSpDebtToken = await MockSpDebtToken.deploy("Mock DAI SpDebtToken", "spDebtDAI", mockDAI.address);
    //     await mockSpDebtToken.deployed();

    //     const MockDaiUsds = await ethers.getContractFactory("MockDaiUsds");
    //     const mockDaiUsds = await MockDaiUsds.deploy(mockDAI.address, mockUSDS.address);
    //     await mockDaiUsds.deployed();

    //     // Deploy mock Aave Lending Pool
    //     const MockAaveLendingPool = await ethers.getContractFactory("MockAavePool");
    //     const mockAavePool = await MockAaveLendingPool.deploy(mockAToken.address, mockADebtToken.address);
    //     await mockAavePool.deployed();
    //     // Deploy mock Comet
    //     const MockComet = await ethers.getContractFactory("MockComet");
    //     const mockComet = await MockComet.deploy(mockUSDS.address, mockWETH9.address);
    //     await mockComet.deployed();
    //     // Deploy mock Uniswap V3 Pool for flash loans
    //     const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool");
    //     const mockUniswapV3Pool = await MockUniswapV3Pool.deploy(mockUSDS.address, mockDAI.address);
    //     await mockUniswapV3Pool.deployed();
    //     // Deploy mock Swap Router
    //     const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
    //     const mockSwapRouter = await MockSwapRouter.deploy();
    //     await mockSwapRouter.deployed();

    //     // 🪙 Initial financing of contracts
    //     // Fund Swap Router
    //     await mockDAI.transfer(mockSwapRouter.address, parseEther("2000"));
    //     await mockUSDS.transfer(mockSwapRouter.address, parseEther("2000"));
    //     await deployer.sendTransaction({
    //         to: mockSwapRouter.address,
    //         value: parseEther("2000")
    //     });
    //     // Fund Uniswap V3 Pool
    //     await mockDAI.transfer(mockUniswapV3Pool.address, parseEther("2000"));
    //     await mockUSDS.transfer(mockUniswapV3Pool.address, parseEther("2000"));
    //     await mockWETH9.transfer(mockUniswapV3Pool.address, parseEther("2000"));
    //     await deployer.sendTransaction({
    //         to: mockUniswapV3Pool.address,
    //         value: parseEther("2000")
    //     });
    //     // Fund Aave Lending Pool
    //     await mockDAI.transfer(mockAavePool.address, parseEther("2000"));
    //     await mockUSDS.transfer(mockAavePool.address, parseEther("2000"));
    //     await mockWETH9.transfer(mockAavePool.address, parseEther("2000"));
    //     await deployer.sendTransaction({
    //         to: mockAavePool.address,
    //         value: parseEther("2000")
    //     });
    //     // Fund Converter (DaiUsds)
    //     await mockDAI.transfer(mockDaiUsds.address, parseEther("2000"));
    //     await mockUSDS.transfer(mockDaiUsds.address, parseEther("2000"));
    //     // Fund Comet
    //     await mockUSDS.transfer(mockComet.address, parseEther("2000"));

    //     return {
    //         deployer,
    //         mockDAI,
    //         mockUSDS,
    //         mockWETH9,
    //         mockAToken,
    //         mockADebtToken,
    //         mockDaiUsds,
    //         mockAavePool,
    //         mockComet,
    //         mockUniswapV3Pool,
    //         mockSwapRouter
    //     };
    // }

    // 🧪 Setup Test Environment: розгортає основний контракт із використанням моків
    async function setupTestEnvironment() {
        const mocks = await setupMocks();

        const [_, owner, user, adapterDeployer] = await ethers.getSigners();
        // Deploy AaveV3Adapter
        const AaveV3AdapterFactory = await ethers.getContractFactory("AaveV3Adapter", adapterDeployer);
        const aaveV3Adapter = (await AaveV3AdapterFactory.connect(owner).deploy({
            uniswapRouter: mocks.mockSwapRouter.address,
            daiUsdsConverter: mocks.mockDaiUsds.address,
            dai: mocks.mockDAI.address,
            usds: mocks.mockUSDS.address,
            wrappedNativeToken: mocks.mockWETH9.address,
            aaveLendingPool: mocks.mockAavePool.address,
            aaveDataProvider: mocks.mockAavePool.address,
            isFullMigration: true
        })) as AaveV3Adapter;
        await aaveV3Adapter.deployed();

        // Deploy SparkAdapter
        const SparkAdapterFactory = await ethers.getContractFactory("SparkAdapter", adapterDeployer);
        const sparkAdapter = (await SparkAdapterFactory.connect(owner).deploy({
            uniswapRouter: mocks.mockSwapRouter.address,
            daiUsdsConverter: mocks.mockDaiUsds.address,
            dai: mocks.mockDAI.address,
            usds: mocks.mockUSDS.address,
            wrappedNativeToken: mocks.mockWETH9.address,
            sparkLendingPool: mocks.mockSparkPool.address,
            sparkDataProvider: mocks.mockSparkPool.address,
            isFullMigration: true
        })) as SparkAdapter;

        await sparkAdapter.deployed();

        const adapters = [aaveV3Adapter.address, sparkAdapter.address];
        const comets = [mocks.mockComet.address];

        // Set up flashData for migrator
        const flashData = [
            {
                liquidityPool: mocks.mockUniswapV3Pool.address,
                baseToken: mocks.mockUSDS.address,
                isToken0: true
            }
        ];

        const MigratorV2Factory = await ethers.getContractFactory("MigratorV2");
        const migrator = await MigratorV2Factory.connect(owner).deploy(owner.address, adapters, comets, flashData);
        await migrator.deployed();

        return {
            mocks,
            owner,
            user,
            adapterDeployer,
            aaveV3Adapter,
            sparkAdapter,
            migrator
        };
    }

    describe("# Deployment", function () {
        context("* AaveV3Adapter", async () => {
            it("Should deploy AaveV3Adapter to a proper address", async () => {
                const { aaveV3Adapter } = await loadFixture(setupTestEnvironment);
                expect(aaveV3Adapter.address).to.be.properAddress;
            });

            it("Should have correct dependencies", async () => {
                const { aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);
                expect(await aaveV3Adapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter.address);
                expect(await aaveV3Adapter.DAI_USDS_CONVERTER()).to.equal(mocks.mockDaiUsds.address);
                expect(await aaveV3Adapter.DAI()).to.equal(mocks.mockDAI.address);
                expect(await aaveV3Adapter.USDS()).to.equal(mocks.mockUSDS.address);
                expect(await aaveV3Adapter.WRAPPED_NATIVE_TOKEN()).to.equal(mocks.mockWETH9.address);
                expect(await aaveV3Adapter.LENDING_POOL()).to.equal(mocks.mockAavePool.address);
            });
        });

        context("* SparkAdapter", async () => {
            it("Should deploy SparkAdapter to a proper address", async () => {
                const { sparkAdapter } = await loadFixture(setupTestEnvironment);
                expect(sparkAdapter.address).to.be.properAddress;
            });

            it("Should have correct dependencies", async () => {
                const { sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
                expect(await sparkAdapter.UNISWAP_ROUTER()).to.equal(mocks.mockSwapRouter.address);
                expect(await sparkAdapter.DAI_USDS_CONVERTER()).to.equal(mocks.mockDaiUsds.address);
                expect(await sparkAdapter.DAI()).to.equal(mocks.mockDAI.address);
                expect(await sparkAdapter.USDS()).to.equal(mocks.mockUSDS.address);
                expect(await sparkAdapter.WRAPPED_NATIVE_TOKEN()).to.equal(mocks.mockWETH9.address);
                expect(await sparkAdapter.LENDING_POOL()).to.equal(mocks.mockSparkPool.address);
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
                const { migrator, aaveV3Adapter, sparkAdapter } = await loadFixture(setupTestEnvironment);
                const adapters = await migrator.getAdapters();
                expect(adapters).to.include(aaveV3Adapter.address);
                expect(adapters).to.include(sparkAdapter.address);
            });

            // it("Should revert if migrating with invalid adapter", async () => {
            //     const { migrator, user } = await loadFixture(setupTestEnvironment);
            //     await expect(
            //         migrator.connect(user).migrate(AddressZero, AddressZero, "0x", 1)
            //     ).to.be.revertedWithCustomError(migrator, "InvalidAdapter");
            // });
        });
    });

    describe("# Migrate functionality", function () {
        context("* AaveV3 -> Comet", async () => {
            // collateral - ETH; borrow - DAI; comet - USDS.
            it("Should migrate a user's position successfully: Scn.#1", async () => {
                const { migrator, user, aaveV3Adapter, mocks } = await loadFixture(setupTestEnvironment);

                // Setup for AaveV3 -> Comet migration
                // Deposit to Aave
                const depositAmount = parseEther("500");
                expect(await mocks.mockAToken.balanceOf(user.address)).to.equal(Zero);
                await mocks.mockAavePool
                    .connect(user)
                    .deposit(NATIVE_TOKEN_ADDRESS, depositAmount, { value: depositAmount });

                expect(await mocks.mockAToken.balanceOf(user.address)).to.equal(depositAmount);

                // Borrow from Aave
                const borrowAmount = parseEther("100");
                expect(await mocks.mockADebtToken.balanceOf(user.address)).to.equal(Zero);
                await mocks.mockAavePool.connect(user).borrow(mocks.mockDAI.address, borrowAmount);
                expect(await mocks.mockADebtToken.balanceOf(user.address)).to.equal(borrowAmount);

                // const collateralAmount = mockAToken.balanceOf(user.address)

                // Init migration
                // Approve migration
                await mocks.mockAToken.connect(user).approve(migrator.address, parseEther("500"));
                const FEE_3000 = 3000; // 0.3%
                const FEE_500 = 500; // 0.05%

                // Convert fee to 3-byte hex
                const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8
                const fee500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_500), 3); // 0x01F4

                // @DEBUG
                // console.log(`Fee 3000 (3 bytes) = ${fee3000}`);
                // console.log(`Fee 500 (3 bytes) = ${fee500}`);

                const position = {
                    borrows: [
                        {
                            aDebtToken: mocks.mockADebtToken.address,
                            amount: parseEther("100")
                        }
                    ],
                    collateral: [{ aToken: mocks.mockAToken.address, amount: parseEther("500") }],
                    swaps: [
                        {
                            pathOfSwapFlashloan: ethers.utils.concat([
                                ethers.utils.hexZeroPad(mocks.mockUSDS.address, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(mocks.mockDAI.address, 20)
                            ]),
                            amountInMaximum: parseEther("100"),
                            pathSwapCollateral: [],
                            amountOutMinimum: 0
                        }
                    ]
                };
                // @DEBUG
                // console.log("position", position.swaps[0].pathOfSwapFlashloan);
                // console.log("USDS address", mocks.mockUSDS.address);
                // console.log("DAI address", mocks.mockDAI.address);

                const encodedData = ethers.utils.defaultAbiCoder.encode(
                    [
                        "tuple(tuple(address aDebtToken, uint256 amount)[] borrows, tuple(address aToken, uint256 amount)[] collateral, tuple(bytes pathOfSwapFlashloan, uint256 amountInMaximum, bytes pathSwapCollateral, uint256 amountOutMinimum)[] swaps)"
                    ],
                    [position]
                );

                const flashAmount = parseEther("500");
                await expect(
                    migrator
                        .connect(user)
                        .migrate(aaveV3Adapter.address, mocks.mockComet.address, encodedData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userCollateral = await mocks.mockComet.collateralBalanceOf(user.address, mocks.mockDAI.address);
                expect(userCollateral).to.not.equal(Zero);
            });
        });

        context("* Spark -> Comet", async () => {
            it("Should migrate a user's position successfully: Scn.#2", async () => {
                const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);

                // Deposit to Spark
                const depositAmount = parseEther("500");
                expect(await mocks.mockSpToken.balanceOf(user.address)).to.equal(Zero);

                await mocks.mockSparkPool
                    .connect(user)
                    .deposit(mocks.mockDAI.address, depositAmount, { value: depositAmount });

                expect(await mocks.mockSpToken.balanceOf(user.address)).to.equal(depositAmount);

                // Borrow from Spark
                const borrowAmount = parseEther("100");
                expect(await mocks.mockSpDebtToken.balanceOf(user.address)).to.equal(Zero);
                await mocks.mockSparkPool.connect(user).borrow(NATIVE_TOKEN_ADDRESS, borrowAmount);
                expect(await mocks.mockSpDebtToken.balanceOf(user.address)).to.equal(borrowAmount);

                // const collateralAmount = mockAToken.balanceOf(user.address)

                // Approve migration
                await mocks.mockSpToken.connect(user).approve(migrator.address, parseEther("500"));
                const FEE_3000 = 3000; // 0.3%
                const FEE_500 = 500; // 0.05%

                // Convert fee to 3-byte hex
                const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3); // 0x0BB8
                const fee500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_500), 3); // 0x01F4

                // @DEBUG
                // console.log(`Fee 3000 (3 bytes) = ${fee3000}`);
                // console.log(`Fee 500 (3 bytes) = ${fee500}`);

                const position = {
                    borrows: [
                        {
                            aDebtToken: mocks.mockSpDebtToken.address,
                            amount: parseEther("100")
                        }
                    ],
                    collateral: [{ aToken: mocks.mockSpToken.address, amount: parseEther("500") }],
                    swaps: [
                        {
                            pathOfSwapFlashloan: ethers.utils.concat([
                                ethers.utils.hexZeroPad(mocks.mockUSDS.address, 20),
                                fee3000,
                                ethers.utils.hexZeroPad(mocks.mockDAI.address, 20)
                            ]),
                            amountInMaximum: parseEther("100"),
                            // pathSwapCollateral: ethers.utils.concat([
                            //     ethers.utils.hexZeroPad(NATIVE_TOKEN_ADDRESS, 20),
                            //     ethers.utils.hexZeroPad(mockUSDS.address, 20),
                            // ]),
                            pathSwapCollateral: [],
                            // amountOutMinimum: parseEther("500"),
                            amountOutMinimum: 0
                        }
                    ]
                };
                // @DEBUG
                // console.log("position", position.swaps[0].pathOfSwapFlashloan);
                // console.log("USDS address", mocks.mockUSDS.address);
                // console.log("DAI address", mocks.mockDAI.address);

                const encodedData = ethers.utils.defaultAbiCoder.encode(
                    [
                        "tuple(tuple(address aDebtToken, uint256 amount)[] borrows, tuple(address aToken, uint256 amount)[] collateral, tuple(bytes pathOfSwapFlashloan, uint256 amountInMaximum, bytes pathSwapCollateral, uint256 amountOutMinimum)[] swaps)"
                    ],
                    [position]
                );

                const flashAmount = parseEther("500");
                await expect(
                    migrator
                        .connect(user)
                        .migrate(sparkAdapter.address, mocks.mockComet.address, encodedData, flashAmount)
                ).to.emit(migrator, "MigrationExecuted");

                const userCollateral = await mocks.mockComet.collateralBalanceOf(user.address, mocks.mockDAI.address);
                expect(userCollateral).to.equal(Zero);
            });
        });

        it("Should revert if flash amount is zero", async () => {
            const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
            await expect(
                migrator.connect(user).migrate(sparkAdapter.address, mocks.mockComet.address, "0x", 0)
            ).to.be.revertedWithCustomError(migrator, "InvalidFlashAmount");
        });

        it("Should revert if migration data is empty", async () => {
            const { migrator, user, sparkAdapter, mocks } = await loadFixture(setupTestEnvironment);
            await expect(
                migrator.connect(user).migrate(sparkAdapter.address, mocks.mockComet.address, "0x", parseEther("100"))
            ).to.be.revertedWithCustomError(migrator, "InvalidMigrationData");
        });

        it("Should revert if Comet is not supported", async () => {
            const { migrator, user, sparkAdapter } = await loadFixture(setupTestEnvironment);
            await expect(
                migrator.connect(user).migrate(sparkAdapter.address, AddressZero, "0x", parseEther("100"))
            ).to.be.revertedWithCustomError(migrator, "CometIsNotSupported");
        });
    });
});
