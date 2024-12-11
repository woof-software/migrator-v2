import { loadFixture, ethers, expect, parseEther, Zero, AddressZero } from "../helpers" // Adjust the path as needed

import type {
    MigratorV2,
    AaveV3Adapter,
    MockAaveLendingPool,
    MockComet,
    MockSwapRouter,
    MockUniswapV3Pool,
    MockDaiUsds,
    MockERC20,
    MockADebtToken,
    MockAToken,
} from "../../typechain-types"
import { use } from "chai"

const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

describe("MigratorV2", function () {
    async function fixtureSetup() {
        const [owner, user, adapterDeployer] = await ethers.getSigners()
        const MockERC20 = await ethers.getContractFactory("MockERC20")

        // Deploy tokens
        const mockDAI: MockERC20 = (await MockERC20.deploy(
            "Mock DAI",
            "DAI",
            parseEther("1000000"),
            owner.address
        )) as MockERC20
        await mockDAI.deployed()

        const mockUSDS: MockERC20 = (await MockERC20.deploy(
            "Mock USDS",
            "mUSDS",
            parseEther("1000000"),
            owner.address
        )) as MockERC20
        await mockUSDS.deployed()

        const MockWETH9 = await ethers.getContractFactory("MockWETH9")
        const mockWETH9 = await MockWETH9.deploy("Mock WETH", "WETH")
        await mockWETH9.deployed()

        const MockAToken = await ethers.getContractFactory("MockAToken")
        const mockAToken: MockAToken = (await MockAToken.deploy(
            "Mock WETH AToken",
            "aWETH",
            NATIVE_TOKEN_ADDRESS
        )) as MockAToken
        await mockAToken.deployed()

        const MockADebtToken = await ethers.getContractFactory("MockADebtToken")
        const mockADebtToken: MockADebtToken = (await MockADebtToken.deploy(
            "Mock DAI ADebtToken",
            "aDebtDAI",
            mockDAI.address
        )) as MockADebtToken
        await mockADebtToken.deployed()

        const MockDaiUsds = await ethers.getContractFactory("MockDaiUsds")
        const mockDaiUsds: MockDaiUsds = (await MockDaiUsds.deploy(
            mockDAI.address,
            mockUSDS.address
        )) as MockDaiUsds
        await mockDaiUsds.deployed()

        // Deploy mock Aave Lending Pool
        const MockAaveLendingPool = await ethers.getContractFactory("MockAaveLendingPool")
        const mockAaveLendingPool: MockAaveLendingPool = (await MockAaveLendingPool.deploy(
            mockAToken.address,
            mockADebtToken.address
        )) as MockAaveLendingPool
        await mockAaveLendingPool.deployed()

        // Deploy mock Comet
        const MockComet = await ethers.getContractFactory("MockComet")
        const mockComet: MockComet = (await MockComet.deploy(
            mockUSDS.address,
            mockWETH9.address
        )) as MockComet
        await mockComet.deployed()

        // Deploy mock Uniswap V3 Pool for flash loans
        const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool")
        const mockUniswapV3Pool: MockUniswapV3Pool = (await MockUniswapV3Pool.deploy(
            mockUSDS.address,
            mockDAI.address
        )) as MockUniswapV3Pool
        await mockUniswapV3Pool.deployed()

        // Deploy mock Swap Router
        const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter")
        const mockSwapRouter: MockSwapRouter = (await MockSwapRouter.deploy()) as MockSwapRouter
        await mockSwapRouter.deployed()

        // Deploy AaveV3Adapter
        const AaveV3AdapterFactory = await ethers.getContractFactory(
            "AaveV3Adapter",
            adapterDeployer
        )
        const aaveV3Adapter: AaveV3Adapter = (await AaveV3AdapterFactory.deploy(
            mockSwapRouter.address,
            mockDaiUsds.address,
            mockDAI.address,
            mockUSDS.address,
            mockWETH9.address,
            mockAaveLendingPool.address
        )) as AaveV3Adapter
        await aaveV3Adapter.deployed()

        // Set up flashData for migrator
        const flashData = {
            liquidityPool: mockUniswapV3Pool.address,
            baseToken: mockUSDS.address,
            isToken0: true,
        }

        // Deploy MigratorV2
        const MigratorV2Factory = await ethers.getContractFactory("MigratorV2")
        const migrator: MigratorV2 = (await MigratorV2Factory.deploy(
            owner.address, // multisig (owner)
            [aaveV3Adapter.address], // adapters
            [mockComet.address], // comets
            [flashData] // flash data
        )) as MigratorV2
        await migrator.deployed()

        // Fund Swap Router
        await mockDAI.transfer(mockSwapRouter.address, parseEther("2000"))
        await mockUSDS.transfer(mockSwapRouter.address, parseEther("2000"))

        // Fund Uniswap V3 Pool
        await mockDAI.transfer(mockUniswapV3Pool.address, parseEther("2000"))
        await mockUSDS.transfer(mockUniswapV3Pool.address, parseEther("2000"))

        // Fund Aave Lending Pool
        await mockDAI.transfer(mockAaveLendingPool.address, parseEther("2000"))
        await mockUSDS.transfer(mockAaveLendingPool.address, parseEther("2000"))

        // Fund Converter (DaiUsds)
        await mockDAI.transfer(mockDaiUsds.address, parseEther("2000"))
        await mockUSDS.transfer(mockDaiUsds.address, parseEther("2000"))

        // // Fund Comet
        await mockUSDS.transfer(mockComet.address, parseEther("2000"))


        // Deposit to Aave
        const depositAmount = parseEther("500")
        expect(await mockAToken.balanceOf(user.address)).to.equal(Zero)
        await mockAaveLendingPool
            .connect(user)
            .deposit(NATIVE_TOKEN_ADDRESS, depositAmount, { value: depositAmount })

        expect(await mockAToken.balanceOf(user.address)).to.equal(depositAmount)

        // Borrow from Aave
        const borrowAmount = parseEther("100")
        expect(await mockADebtToken.balanceOf(user.address)).to.equal(Zero)
        await mockAaveLendingPool.connect(user).borrow(mockDAI.address, borrowAmount)
        expect(await mockADebtToken.balanceOf(user.address)).to.equal(borrowAmount)

        // For debugging
        console.log("DAI address", mockDAI.address);
        console.log("USDS address", mockUSDS.address);
        console.log("WrappedToken address", mockWETH9.address);
        console.log("MockDaiUsds address", mockDaiUsds.address);

        console.log("MockAaveLendingPool address", mockAaveLendingPool.address);
        console.log("MockComet address", mockComet.address);
        console.log("MockUniswapV3Pool address", mockUniswapV3Pool.address);
        console.log("MockSwapRouter address", mockSwapRouter.address);

        console.log("AaveV3Adapter address", aaveV3Adapter.address);
        console.log("MigratorV2 address", migrator.address);

        return {
            owner,
            user,
            adapterDeployer,
            mockDAI,
            mockUSDS,
            mockAToken,
            mockADebtToken,
            mockWETH9,
            mockDaiUsds,
            mockAaveLendingPool,
            mockComet,
            mockUniswapV3Pool,
            mockSwapRouter,
            aaveV3Adapter,
            migrator,
        }
    }

    describe("# Deployment", function () {
        it("Should deploy MigratorV2 to a proper address", async () => {
            const { migrator, user, adapterDeployer } = await loadFixture(fixtureSetup)
            expect(migrator.address).to.be.properAddress

            console.log("user.address", user.address)
            console.log("adapterDeployer.address", adapterDeployer.address)
        })

        it("Should have correct adapter registered", async () => {
            const { migrator, aaveV3Adapter } = await loadFixture(fixtureSetup)
            const adapters = await migrator.getAdapters()
            expect(adapters).to.include(aaveV3Adapter.address)
        })

        it("Should revert if migrating with invalid adapter", async () => {
            const { migrator, user } = await loadFixture(fixtureSetup)
            await expect(
                migrator.connect(user).migrate(AddressZero, AddressZero, "0x", 1)
            ).to.be.revertedWithCustomError(migrator, "InvalidAdapter")
        })
    })

    describe("# Migrate functionality", function () {
        it("Should migrate a user's position successfully", async () => {
            const {
                migrator,
                user,
                aaveV3Adapter,
                mockComet,
                mockAToken,
                mockADebtToken,
                mockUSDS,
                mockDAI,
                mockWETH9,
            } = await loadFixture(fixtureSetup)

            // const collateralAmount = mockAToken.balanceOf(user.address)

            // Approve migration
            await mockAToken.connect(user).approve(migrator.address, parseEther("500"))
            const FEE_3000 = 3000 // 0.3%
            const FEE_500 = 500 // 0.05%

            // Convert fee to 3-byte hex
            const fee3000 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_3000), 3) // 0x0BB8
            const fee500 = ethers.utils.hexZeroPad(ethers.utils.hexlify(FEE_500), 3) // 0x01F4

            console.log(`Fee 3000 (3 bytes) = ${fee3000}`)
            console.log(`Fee 500 (3 bytes) = ${fee500}`)

            const position = {
                borrows: [
                    {
                        aDebtToken: mockADebtToken.address,
                        amount: parseEther("100"),
                    },
                ],
                collateral: [{ aToken: mockAToken.address, amount: parseEther("500") }],
                swaps: [
                    {
                        pathOfSwapFlashloan: ethers.utils.concat([
                            ethers.utils.hexZeroPad(mockUSDS.address, 20),
                            ethers.utils.hexZeroPad(mockDAI.address, 20),
                        ]),
                        amountInMaximum: parseEther("100"),
                        // pathSwapCollateral: ethers.utils.concat([
                        //     ethers.utils.hexZeroPad(NATIVE_TOKEN_ADDRESS, 20),
                        //     ethers.utils.hexZeroPad(mockUSDS.address, 20),
                        // ]),
                        pathSwapCollateral: [],
                        // amountOutMinimum: parseEther("500"),
                        amountOutMinimum: 0,
                    },
                ],
            }
            console.log("position", position.swaps[0].pathOfSwapFlashloan)
            console.log("USDS address", mockUSDS.address)
            console.log("DAI address", mockDAI.address)

            const encodedData = ethers.utils.defaultAbiCoder.encode(
                [
                    "tuple(tuple(address aDebtToken, uint256 amount)[] borrows, tuple(address aToken, uint256 amount)[] collateral, tuple(bytes pathOfSwapFlashloan, uint256 amountInMaximum, bytes pathSwapCollateral, uint256 amountOutMinimum)[] swaps)",
                ],
                [position]
            )

            const flashAmount = parseEther("500")
            await expect(
                migrator
                    .connect(user)
                    .migrate(aaveV3Adapter.address, mockComet.address, encodedData, flashAmount)
            ).to.emit(migrator, "AdapterExecuted")

            const userCollateral = await mockComet.collateralBalanceOf(
                await user.getAddress(),
                mockDAI.address
            )
            expect(userCollateral).to.be.not.equal(Zero)
        })

        it("Should revert if flash amount is zero", async () => {
            const { migrator, user, aaveV3Adapter, mockComet } = await loadFixture(fixtureSetup)
            await expect(
                migrator.connect(user).migrate(aaveV3Adapter.address, mockComet.address, "0x", 0)
            ).to.be.revertedWithCustomError(migrator, "InvalidFlashAmount")
        })

        it("Should revert if migration data is empty", async () => {
            const { migrator, user, aaveV3Adapter, mockComet } = await loadFixture(fixtureSetup)
            await expect(
                migrator
                    .connect(user)
                    .migrate(aaveV3Adapter.address, mockComet.address, "0x", parseEther("100"))
            ).to.be.revertedWithCustomError(migrator, "InvalidMigrationData")
        })

        it("Should revert if Comet is not supported", async () => {
            const { migrator, user, aaveV3Adapter } = await loadFixture(fixtureSetup)
            await expect(
                migrator
                    .connect(user)
                    .migrate(aaveV3Adapter.address, AddressZero, "0x", parseEther("100"))
            ).to.be.revertedWithCustomError(migrator, "CometIsNotSupported")
        })
    })
})
