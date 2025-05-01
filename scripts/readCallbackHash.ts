import eth from "ethers";
import hre from "hardhat";

async function main() {
    const contractName = "MigratorV2";
    const variableName = "_storedCallbackHash";
    const contractAddress = "0x0ef2c369A5c5EbFe06C6a54276206b076319c99f";

    // Отримуємо точне ім’я файлу з артефакту
    const artifact = await hre.artifacts.readArtifact(contractName);
    const buildInfo = await hre.artifacts.getBuildInfo(`${artifact.sourceName}:${contractName}`);
    if (!buildInfo) {
        console.error(`Build info for ${contractName} not found`);
        return;
    }

    const layout = (buildInfo.output.contracts[artifact.sourceName][contractName] as any).storageLayout;
    const entry = layout.storage.find((s: any) => s.label === variableName);
    if (!entry) {
        console.error(`Variable ${variableName} not found`);
        return;
    }

    const slot: string = entry.slot;
    console.log(`Slot for ${variableName}:`, slot);

    const provider = new eth.providers.JsonRpcProvider(
        "https://eth-mainnet.g.alchemy.com/v2/r5h-v41S-KorgIoTl7JGs3G-0wus2AMP"
    );
    const value = await provider.getStorageAt(contractAddress, BigInt(slot));
    console.log(`${variableName} value:`, value);
}

main().catch(console.error);
