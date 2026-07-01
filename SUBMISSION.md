# Proof Of Building

Use these values for the Ritual Academy form after deployment.

## Step 1

GitHub Fork URL:

```text
<your separate GitHub repo URL for ritual-blind-tribunal>
```

Deployed Contract Address:

```text
0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2
```

Deploy Transaction Hash:

```text
0x4a382c9742b1ac0b8a53c7798c84fe9690e60be865dfc57b12a819d67639a8e7
```

A step you struggled with:

```text
The hardest step was making each wallet behave like its own account in a blind review flow. I had to bind the answer, salt, sender, and bountyId together so another account cannot reveal a copied answer, then test early reveals, late commits, duplicate commits, wrong salts, batch verdicts, and winner finalization.
```

## Step 2

An error you hit and how you resolved it:

```text
I hit edge cases around account identity. If the sender was not part of the seal, a copied answer could be opened by another wallet. I fixed it by verifying keccak256(abi.encode(answer, salt, msg.sender, bountyId)) against the stored commitment and added tests for wrong salts, missing commitments, early reveals, and duplicate reveals.
```

Overall rating:

```text
9
```

Loom recording URL:

```text

```

## Short Message

```text
I built Ritual Blind Tribunal, a second-wallet commit-reveal project for fair bounty judging. Each wallet is treated as one account: it seals an answer hash first, opens the answer and salt after the deadline, and only valid account-bound reveals enter one batch AI verdict.
```
