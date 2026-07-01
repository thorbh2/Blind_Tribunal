import "dotenv/config";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { ethers } from "ethers";

if (!existsSync("artifacts/BlindTribunalJudge.json")) {
  await import("./compile.mjs");
}

const rpcUrl = process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const chainId = Number(process.env.RITUAL_CHAIN_ID || 1979);
const privateKey = process.env.WALLET2_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("Missing WALLET2_PRIVATE_KEY in .env. It must be 0x + 64 hex chars.");
}

const artifact = JSON.parse(await fs.readFile("artifacts/BlindTribunalJudge.json", "utf8"));
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
const wallet = new ethers.Wallet(privateKey, provider);
const balance = await provider.getBalance(wallet.address);

console.log(`Deployer: ${wallet.address}`);
console.log(`Balance: ${ethers.formatEther(balance)} RITUAL`);

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployTxRequest = await factory.getDeployTransaction();
const gasEstimate = await wallet.estimateGas(deployTxRequest);
const feeData = await provider.getFeeData();
const estimatedCost = gasEstimate * (feeData.gasPrice ?? 0n);
console.log(`Estimated gas: ${gasEstimate.toString()}`);
console.log(`Estimated cost: ${ethers.formatEther(estimatedCost)} RITUAL`);

const contract = await factory.deploy();
const deploymentTx = contract.deploymentTransaction();
console.log(`Deploy tx: ${deploymentTx?.hash}`);
await contract.waitForDeployment();

const address = await contract.getAddress();
const receipt = deploymentTx ? await provider.getTransactionReceipt(deploymentTx.hash) : null;
console.log(`BlindTribunalJudge: ${address}`);
console.log(`Gas used: ${receipt?.gasUsed?.toString() ?? "unknown"}`);

await fs.writeFile(
  "deploy-blind-tribunal.json",
  JSON.stringify(
    {
      contract: "BlindTribunalJudge",
      address,
      deployTx: deploymentTx?.hash,
      deployer: wallet.address,
      gasUsed: receipt?.gasUsed?.toString(),
      chainId
    },
    null,
    2
  )
);
