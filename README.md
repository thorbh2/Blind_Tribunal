# Ritual Blind Tribunal

Standalone second-wallet submission for the Ritual Academy Privacy-Preserving AI Bounty Judge assignment.

## Problem

In a normal bounty system, the first person to publish a good answer can accidentally become the template for everyone else. Ritual Blind Tribunal turns the process into a blind court: accounts seal answers first, open proof later, and only verified reveals enter one batch verdict.

## Contract

`BlindTribunalJudge.sol` implements the required flow:

Wallet 2 deployment status:

```text
0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2
```

Wallet 2 deploy transaction:

```text
0x4a382c9742b1ac0b8a53c7798c84fe9690e60be865dfc57b12a819d67639a8e7
```

```solidity
submitCommitment(uint256 bountyId, bytes32 commitment)
revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)
judgeAll(uint256 bountyId, bytes calldata llmInput)
finalizeWinner(uint256 bountyId, uint256 winnerIndex)
```

The commitment is:

```solidity
keccak256(abi.encode(answer, salt, msg.sender, bountyId))
```

Binding the sender and bounty ID prevents a copied reveal from another wallet or another bounty from passing verification.

In the product model, one wallet address is one account. A participant account cannot hand its reveal to another address because the sender is part of the commitment.

## Lifecycle

1. A case creator calls `createBounty` with a prompt URI, prompt hash, commit deadline, and reveal deadline.
2. During the sealed phase, each account calls `submitCommitment` with only a hash.
3. After the commit deadline, accounts call `revealAnswer` with the answer and salt.
4. The contract recomputes the seal and accepts only valid reveals.
5. After the reveal deadline, the judge or creator calls `judgeAll` with one canonical verdict batch.
6. The contract stores only `keccak256(llmInput)` so the verdict batch can be audited.
7. The judge or creator calls `finalizeWinner` with an index from the eligible revealed accounts.

## What Is Onchain

- Case creator
- Prompt URI and prompt hash
- Commit and reveal deadlines
- Commitment hashes
- Revealed answer text, salt, answer hash, and participant address after reveal
- Batch verdict input hash
- Winner index, winner submission ID, and winning account address

## What Stays Hidden

The answer and salt stay offchain with the participant during the commit phase. They become public only during reveal, after copying during the submission window is no longer useful.

## Ritual-Native Hidden Submission Extension

The advanced Ritual-native version would encrypt answers to a TEE-backed tribunal key during the sealed period. Onchain storage would keep ciphertext hashes, prompt hashes, deadlines, and receipts. Plaintext would exist only inside the participant client before encryption and inside the Ritual TEE during the single batch verdict run. The LLM receives one batch containing all eligible decrypted submissions, not one request per answer.

## Test Plan

The test script covers:

- contract compilation
- local EVM deployment
- case creation
- empty commitment rejection
- duplicate commitment rejection
- early reveal rejection
- late commitment rejection
- missing commitment rejection
- wrong salt rejection
- valid reveal acceptance after commit closes
- batch verdict only after reveal closes
- judge authorization
- winner finalization from eligible revealed answers
- invalid winner and double-finalize rejection

Run:

```bash
npm install
npm test
```

## Frontend

The frontend is live-only. It reads:

- `nextBountyId`
- `bounties`
- revealed counts
- contract storage for every visible case

No preset case rows are rendered. If the contract has no cases yet, the docket stays empty until `createBounty` writes to chain.

Run locally:

```bash
npm run dev
```

## Deploy

Copy `.env.example` to `.env`, fill a burner private key, then run:

```bash
npm run deploy
```

After deployment, set:

```env
VITE_BLIND_TRIBUNAL_ADDRESS=0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2
```

## Reflection

Public data should include the bounty prompt hash, deadlines, commitment hashes, reveal receipts, the final winner, and enough batch-judging evidence for anyone to audit the process. Hidden data should include the answer and salt until the reveal phase opens, because the whole point is to stop copying while submissions are still active. AI should help score eligible answers in one consistent batch, especially for structured rubrics like clarity, originality, and security. Humans should decide the bounty prompt, the rubric, whether the AI result is acceptable, and any dispute resolution. The contract should enforce timing, identity binding, and eligibility rules because those are objective. The AI should never be trusted to decide who is eligible; it should only judge answers that the contract already verified.
