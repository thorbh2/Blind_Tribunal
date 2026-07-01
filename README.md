# Ritual Blind Tribunal

[Live app](https://ritual-blind-tribunal.vercel.app) · [Contract](https://explorer.ritualfoundation.org/address/0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2) · [Deploy tx](https://explorer.ritualfoundation.org/tx/0x4a382c9742b1ac0b8a53c7798c84fe9690e60be865dfc57b12a819d67639a8e7)

A commit-reveal bounty judge for Ritual testnet.

The goal is simple: stop public bounty submissions from becoming a copy-and-improve race. Builders submit a sealed hash during the commit window, reveal only after the deadline, and only valid account-bound reveals can be passed into the judging batch.

## Why it exists

In a normal public bounty flow, the first strong answer often becomes free research for everyone else. Blind Tribunal makes the submission phase private without making the final result unauditable.

The contract keeps the rules objective:

- one commitment per wallet per bounty
- no reveal before the commit window closes
- no late commits
- reveal must match the original sender and bounty ID
- the judging batch is recorded as a hash before the winner is finalized

## Deployed contract

```text
Network: Ritual Chain testnet
Chain ID: 1979
Contract: 0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2
Deploy tx: 0x4a382c9742b1ac0b8a53c7798c84fe9690e60be865dfc57b12a819d67639a8e7
```

## Contract interface

```solidity
submitCommitment(uint256 bountyId, bytes32 commitment)
revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)
judgeAll(uint256 bountyId, bytes calldata llmInput)
finalizeWinner(uint256 bountyId, uint256 winnerIndex)
```

Commitments are bound to the answer, salt, sender, and bounty:

```solidity
keccak256(abi.encode(answer, salt, msg.sender, bountyId))
```

That sender binding matters. A copied answer cannot be revealed from a different wallet and still pass verification.

## Flow

1. A bounty is opened with a prompt URI, prompt hash, commit deadline, and reveal deadline.
2. During the commit phase, builders submit only a `bytes32` commitment.
3. After the commit deadline, builders reveal the answer and salt.
4. The contract recomputes the hash and accepts only valid reveals.
5. Once reveal is closed, the judge submits one batch judging payload.
6. The contract stores `keccak256(llmInput)` and finalizes a winner from the eligible reveal list.

## What is public

- bounty metadata and deadlines
- commitment hashes
- revealed answers after the reveal window opens
- participant addresses
- batch judging hash
- winner index and winner address

## What stays hidden

The answer and salt stay with the builder during the commit phase. They become public only when reveal starts, which removes the incentive to copy during the active submission window.

## Ritual-native extension

The advanced version would encrypt answers to a TEE-backed tribunal key. Onchain state would store ciphertext hashes, deadlines, and receipts. Plaintext would exist only in the user client before encryption and inside the Ritual execution environment during one batch judging run.

## Local setup

```bash
npm install
npm test
npm run dev
```

To deploy your own copy:

```bash
cp .env.example .env
npm run deploy
```

Then set the frontend contract address:

```env
VITE_BLIND_TRIBUNAL_ADDRESS=0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2
```

## Tests

The test suite covers deployment, bounty creation, early/late phase checks, duplicate commits, missing commits, wrong salts, valid reveals, batch judging authorization, winner finalization, invalid winners, and double-finalize protection.

## Frontend

The app is wired to the live contract. It reads current bounty state from Ritual testnet and keeps the UI empty until real cases exist onchain.
