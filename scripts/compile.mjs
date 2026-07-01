import fs from "node:fs/promises";
import path from "node:path";
import solc from "solc";

const contractName = "BlindTribunalJudge";
const sourcePath = path.join("contracts", `${contractName}.sol`);
const source = await fs.readFile(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    [sourcePath]: { content: source }
  },
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

const contract = output.contracts[sourcePath][contractName];
await fs.mkdir("artifacts", { recursive: true });
await fs.writeFile(
  path.join("artifacts", `${contractName}.json`),
  JSON.stringify({ abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2)
);

console.log(`Compiled ${contractName}`);
