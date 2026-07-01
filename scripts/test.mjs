import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, keccak256, toUtf8Bytes } from "ethers";
import "./compile.mjs";

const artifact = JSON.parse(fs.readFileSync("artifacts/BlindTribunalJudge.json", "utf8"));
const ganacheProvider = ganache.provider({
  chain: { chainId: 1979 },
  logging: { quiet: true },
  wallet: { totalAccounts: 5, defaultBalance: 100 }
});
const provider = new BrowserProvider(ganacheProvider);
const [owner, creator, alice, bob, stranger] = await Promise.all([0, 1, 2, 3, 4].map((index) => provider.getSigner(index)));

async function send(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function expectRevert(label, action) {
  try {
    await send(action());
  } catch {
    return;
  }
  throw new Error(`Expected revert: ${label}`);
}

async function increaseTime(seconds) {
  await ganacheProvider.request({ method: "evm_increaseTime", params: [seconds] });
  await ganacheProvider.request({ method: "evm_mine", params: [] });
}

async function jumpPast(targetTimestamp) {
  const latest = await ganacheProvider.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const rawNow = BigInt(latest.timestamp);
  const now = rawNow > 10_000_000_000n ? rawNow / 1_000n : rawNow;
  if (now <= targetTimestamp) {
    await increaseTime(Number(targetTimestamp - now + 1n));
  }
}

const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
const bountyJudge = await factory.deploy();
await bountyJudge.waitForDeployment();

const nowBlock = await ganacheProvider.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
const rawNow = BigInt(nowBlock.timestamp);
const now = rawNow > 10_000_000_000n ? rawNow / 1_000n : rawNow;
const promptCid = "ipfs://ritual-bounty-prompt";
const promptHash = keccak256(toUtf8Bytes("Judge a privacy-preserving Ritual submission fairly."));
const commitDeadline = now + 120n;
const revealDeadline = commitDeadline + 120n;

await send(bountyJudge.connect(creator).createBounty(promptCid, promptHash, commitDeadline, revealDeadline));
assert.equal((await bountyJudge.nextBountyId()).toString(), "2", "first bounty should increment nextBountyId");

const aliceAnswer = "Use commit reveal so nobody can copy answers during the submission window.";
const bobAnswer = "Batch all valid revealed answers for one AI judge pass.";
const aliceSalt = keccak256(toUtf8Bytes("alice secret salt"));
const bobSalt = keccak256(toUtf8Bytes("bob secret salt"));
const aliceAddress = await alice.getAddress();
const bobAddress = await bob.getAddress();
const aliceCommitment = await bountyJudge.computeCommitment(aliceAnswer, aliceSalt, aliceAddress, 1);
const bobCommitment = await bountyJudge.computeCommitment(bobAnswer, bobSalt, bobAddress, 1);

await expectRevert("empty commitment", () => bountyJudge.connect(stranger).submitCommitment(1, "0x0000000000000000000000000000000000000000000000000000000000000000"));
await send(bountyJudge.connect(alice).submitCommitment(1, aliceCommitment));
await send(bountyJudge.connect(bob).submitCommitment(1, bobCommitment));
await expectRevert("duplicate commitment", () => bountyJudge.connect(alice).submitCommitment(1, aliceCommitment));
await expectRevert("early reveal", () => bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt));

await jumpPast(commitDeadline);
await expectRevert("late commitment", () => bountyJudge.connect(stranger).submitCommitment(1, keccak256(toUtf8Bytes("late"))));
await expectRevert("missing commitment", () => bountyJudge.connect(stranger).revealAnswer(1, "copied", aliceSalt));
await expectRevert("wrong salt", () => bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, bobSalt));

await send(bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt, { gasLimit: 800000 }));
await expectRevert("duplicate reveal", () => bountyJudge.connect(alice).revealAnswer(1, aliceAnswer, aliceSalt));
await send(bountyJudge.connect(bob).revealAnswer(1, bobAnswer, bobSalt, { gasLimit: 800000 }));
assert.equal((await bountyJudge.getRevealedSubmissionCount(1)).toString(), "2", "two valid reveals should be eligible");

await expectRevert("judge before reveal close", () => bountyJudge.connect(creator).judgeAll(1, toUtf8Bytes("too early")));
await jumpPast(revealDeadline);
await expectRevert("untrusted judge", () => bountyJudge.connect(stranger).judgeAll(1, toUtf8Bytes("batch")));

const batchInput = toUtf8Bytes(JSON.stringify({ bountyId: 1, eligibleSubmissionIds: [1, 2], scoring: "clarity, originality, security" }));
await send(bountyJudge.connect(creator).judgeAll(1, batchInput, { gasLimit: 800000 }));
const judgedBounty = await bountyJudge.bounties(1);
assert.equal(judgedBounty.judged, true, "bounty should be marked judged");
assert.equal(judgedBounty.llmInputHash, keccak256(batchInput), "LLM batch input hash mismatch");

await expectRevert("bad winner index", () => bountyJudge.connect(creator).finalizeWinner(1, 2));
await send(bountyJudge.connect(creator).finalizeWinner(1, 1));
const finalizedBounty = await bountyJudge.bounties(1);
assert.equal(finalizedBounty.finalized, true, "bounty should be finalized");
assert.equal(finalizedBounty.winner, bobAddress, "winner should match selected revealed submission");
await expectRevert("double finalize", () => bountyJudge.connect(creator).finalizeWinner(1, 0));

console.log(
  JSON.stringify(
    {
      status: "PASS",
      chainId: "1979",
      tests: [
        "compile standalone contract",
        "deploy on a local EVM",
        "create bounty",
        "reject empty and duplicate commitments",
        "reject early reveals",
        "reject late commitments",
        "reject missing commitments and wrong salts",
        "accept valid reveals only after the commit deadline",
        "batch judge after reveal deadline",
        "finalize winner from eligible revealed answers"
      ]
    },
    null,
    2
  )
);
