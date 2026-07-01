import {
  AbiCoder,
  BrowserProvider,
  Contract,
  getAddress,
  hexlify,
  isAddress,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  ZeroAddress
} from "ethers";
import "./styles.css";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", handler: (...args: unknown[]) => void): void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }

  interface ImportMetaEnv {
    readonly VITE_RITUAL_RPC_URL?: string;
    readonly VITE_RITUAL_CHAIN_ID?: string;
    readonly VITE_BLIND_TRIBUNAL_ADDRESS?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

type BountyRecord = {
  id: number;
  creator: string;
  promptCid: string;
  promptHash: string;
  commitDeadline: number;
  revealDeadline: number;
  judged: boolean;
  finalized: boolean;
  llmInputHash: string;
  winnerIndex: bigint;
  winnerSubmissionId: bigint;
  winner: string;
  commitmentCount: bigint;
  revealCount: bigint;
};

const tribunalAbi = [
  "function nextBountyId() view returns (uint256)",
  "function owner() view returns (address)",
  "function bounties(uint256 bountyId) view returns (address creator,string promptCid,bytes32 promptHash,uint64 commitDeadline,uint64 revealDeadline,bool judged,bool finalized,bytes32 llmInputHash,uint256 winnerIndex,uint256 winnerSubmissionId,address winner,uint256 commitmentCount,uint256 revealCount)",
  "function submissionIdOf(uint256 bountyId,address participant) view returns (uint256)",
  "function getRevealedSubmissionCount(uint256 bountyId) view returns (uint256)",
  "function getRevealedSubmissionIds(uint256 bountyId) view returns (uint256[])",
  "function computeCommitment(string answer,bytes32 salt,address participant,uint256 bountyId) pure returns (bytes32)",
  "function createBounty(string promptCid,bytes32 promptHash,uint64 commitDeadline,uint64 revealDeadline) returns (uint256 bountyId)",
  "function submitCommitment(uint256 bountyId,bytes32 commitment)",
  "function revealAnswer(uint256 bountyId,string answer,bytes32 salt)",
  "function judgeAll(uint256 bountyId,bytes llmInput)",
  "function finalizeWinner(uint256 bountyId,uint256 winnerIndex)"
];

const deployedBlindTribunalAddress = "0x22b3f7F8DACe7fC10A5dC168300De9aBF479e0c2";
const contractAddress = import.meta.env.VITE_BLIND_TRIBUNAL_ADDRESS || deployedBlindTribunalAddress;
const rpcUrl = import.meta.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const chainId = Number(import.meta.env.VITE_RITUAL_CHAIN_ID || 1979);
const chainHex = `0x${chainId.toString(16)}`;
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const coder = AbiCoder.defaultAbiCoder();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <div class="app-shell">
    <aside class="side-rail" aria-label="Blind Tribunal controls">
      <a class="rail-brand" href="#console" aria-label="Ritual Blind Tribunal">
        <img src="/assets/blind-tribunal-logo.svg" alt="" />
        <span>
          <strong>Blind Tribunal</strong>
          <small>Ritual account court</small>
        </span>
      </a>

      <button class="connect" data-connect type="button">Connect Account</button>

      <nav class="rail-nav">
        <a href="#console"><span>01</span> Console</a>
        <a href="#seal"><span>02</span> Case lanes</a>
        <a href="#rules"><span>03</span> Rules</a>
      </nav>

      <div class="rail-readout">
        <span>Connected account</span>
        <strong data-wallet>none</strong>
      </div>

      <div class="rail-readout">
        <span>Contract</span>
        <strong data-short-address>not configured</strong>
      </div>

      <a class="docs-link" href="https://docs.ritualfoundation.org/" target="_blank" rel="noreferrer">Ritual docs</a>
    </aside>

    <main class="console" id="console">
      <section class="command-deck">
        <article class="scene-panel">
          <img src="/assets/blind-tribunal-hero.png" alt="" />
          <div class="scene-overlay">
            <span class="system-tag">Wallet 2 module</span>
            <h1>Blind Tribunal</h1>
            <p>
              Account-bound commit reveal for bounties: builders seal answers first,
              open proofs after the deadline, and enter one verified AI judging batch.
            </p>
          </div>
        </article>

        <aside class="state-panel">
          <div class="panel-head">
            <span>Live Ritual Testnet</span>
            <button data-refresh type="button">Refresh</button>
          </div>
          <code data-contract-address>VITE_BLIND_TRIBUNAL_ADDRESS is empty</code>
          <p data-status>Waiting for contract address.</p>
          <div class="state-grid">
            <div><span>Next case</span><strong data-next-id>-</strong></div>
            <div><span>Cases</span><strong data-count>-</strong></div>
            <div><span>Identity rule</span><strong>sender-bound</strong></div>
          </div>
        </aside>
      </section>

      <section class="docket-console" id="docket">
        <div class="section-kicker">onchain docket</div>
        <div class="docket-layout">
          <div class="docket-stack" data-bounty-list></div>
          <article class="evidence-pane" data-inspector></article>
        </div>
      </section>

      <section class="chamber-grid" id="seal">
        <form class="chamber chamber-open" data-create-form>
          <div class="chamber-title">
            <span>open case</span>
            <strong>01</strong>
          </div>
          <label>
            Prompt CID or URI
            <input name="promptCid" autocomplete="off" required />
          </label>
          <label>
            Prompt text for hashing
            <textarea name="promptText" required></textarea>
          </label>
          <div class="two-fields">
            <label>
              Commit minutes
              <input name="commitMinutes" type="number" min="1" step="1" required />
            </label>
            <label>
              Reveal minutes
              <input name="revealMinutes" type="number" min="1" step="1" required />
            </label>
          </div>
          <button type="submit">Create onchain case</button>
        </form>

        <form class="chamber chamber-seal" data-submit-form>
          <div class="chamber-title">
            <span>account seal</span>
            <strong>02</strong>
          </div>
          <div class="two-fields">
            <label>
              Case ID
              <input name="bountyId" inputmode="numeric" required />
            </label>
            <label>
              Salt or bytes32
              <input name="salt" autocomplete="off" required />
            </label>
          </div>
          <label>
            Answer
            <textarea name="answer" required></textarea>
          </label>
          <div class="seal-hash">
            <span>computed commitment</span>
            <code data-commitment>connect account and fill the form</code>
          </div>
          <div class="action-split">
            <button name="action" value="commit" type="submit">Seal</button>
            <button name="action" value="reveal" type="submit">Reveal</button>
          </div>
        </form>

        <form class="chamber chamber-verdict" id="verdict" data-judge-form>
          <div class="chamber-title">
            <span>verdict</span>
            <strong>03</strong>
          </div>
          <div class="two-fields">
            <label>
              Case ID
              <input name="bountyId" inputmode="numeric" required />
            </label>
            <label>
              Winner index
              <input name="winnerIndex" inputmode="numeric" />
            </label>
          </div>
          <label>
            Batch input for AI judge
            <textarea name="llmInput"></textarea>
          </label>
          <div class="action-split">
            <button name="action" value="judge" type="submit">Anchor batch</button>
            <button name="action" value="finalize" type="submit">Finalize</button>
          </div>
        </form>
      </section>

      <section class="rules-matrix" id="rules">
        <article class="seal-card">
          <img src="/assets/blind-account-seal.png" alt="" />
          <div>
            <span>account passport</span>
            <h2>Every reveal belongs to one wallet only.</h2>
          </div>
        </article>
        <div class="rule-board">
          <article><b>Public</b><p>Prompt hash, prompt URI, deadlines, commitment counts, reveal counts, batch hash, winner.</p></article>
          <article><b>Hidden first</b><p>The answer stays off-chain until reveal, while the chain stores only its sender-bound seal.</p></article>
          <article><b>Verified</b><p>The contract recomputes keccak256(answer, salt, sender, bountyId) before accepting the reveal.</p></article>
          <article><b>Judged once</b><p>Valid revealed answers enter one canonical batch AI input before finalization.</p></article>
        </div>
      </section>
    </main>
  </div>
`;

const readProvider = new JsonRpcProvider(rpcUrl, chainId);
const readContract = contractAddress ? new Contract(contractAddress, tribunalAbi, readProvider) : null;
const connectButton = document.querySelector<HTMLButtonElement>("[data-connect]");
const refreshButton = document.querySelector<HTMLButtonElement>("[data-refresh]");
const statusNode = document.querySelector<HTMLElement>("[data-status]");
const shortAddressNode = document.querySelector<HTMLElement>("[data-short-address]");
const contractAddressNode = document.querySelector<HTMLElement>("[data-contract-address]");
const nextIdNode = document.querySelector<HTMLElement>("[data-next-id]");
const countNode = document.querySelector<HTMLElement>("[data-count]");
const walletNode = document.querySelector<HTMLElement>("[data-wallet]");
const bountyList = document.querySelector<HTMLDivElement>("[data-bounty-list]");
const inspector = document.querySelector<HTMLElement>("[data-inspector]");
const createForm = document.querySelector<HTMLFormElement>("[data-create-form]");
const submitForm = document.querySelector<HTMLFormElement>("[data-submit-form]");
const judgeForm = document.querySelector<HTMLFormElement>("[data-judge-form]");
const commitmentNode = document.querySelector<HTMLElement>("[data-commitment]");

let walletAddress = "";
let writeContract: Contract | null = null;
let bounties: BountyRecord[] = [];
let activeBountyId = 0;

if (shortAddressNode) shortAddressNode.textContent = contractAddress ? shortHash(contractAddress, 6, 4) : "not configured";
if (contractAddressNode) contractAddressNode.textContent = contractAddress || "VITE_BLIND_TRIBUNAL_ADDRESS is empty";

function shortHash(value: string, head = 8, tail = 6) {
  if (!value || value === ZeroAddress) return "none";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function zeroHash(value: string) {
  return value === zeroBytes32;
}

function setStatus(message: string) {
  if (statusNode) statusNode.textContent = message;
}

function escapeHtml(value: string | number | bigint | boolean) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readFormValue(form: HTMLFormElement, key: string) {
  return String(new FormData(form).get(key) ?? "").trim();
}

function readFormNumber(form: HTMLFormElement, key: string) {
  return Number(readFormValue(form, key));
}

function phaseOf(record: BountyRecord) {
  const now = Math.floor(Date.now() / 1000);
  if (record.finalized) return "Finalized";
  if (record.judged) return "Judged";
  if (now <= record.commitDeadline) return "Commit";
  if (now <= record.revealDeadline) return "Reveal";
  return "Judge";
}

function timeLabel(timestamp: number) {
  const diff = timestamp - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "closed";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function normalizeSalt(value: string) {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value;
  return keccak256(toUtf8Bytes(value));
}

function computeCommitment(answer: string, salt: string, participant: string, bountyId: bigint) {
  const encoded = coder.encode(["string", "bytes32", "address", "uint256"], [answer, salt, getAddress(participant), bountyId]);
  return keccak256(encoded);
}

function updateCommitmentPreview() {
  if (!submitForm || !commitmentNode) return;
  const bountyId = BigInt(Math.max(1, Math.floor(readFormNumber(submitForm, "bountyId") || 1)));
  const answer = readFormValue(submitForm, "answer");
  const saltText = readFormValue(submitForm, "salt");
  if (!walletAddress || !answer || !saltText) {
    commitmentNode.textContent = "connect account and fill the form";
    return;
  }
  commitmentNode.textContent = computeCommitment(answer, normalizeSalt(saltText), walletAddress, bountyId);
}

async function ensureWallet() {
  if (!window.ethereum) throw new Error("Account wallet extension not found.");
  if (!contractAddress) throw new Error("Blind tribunal contract address is not configured.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : 0;
    if (code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainHex,
          chainName: "Ritual Testnet",
          nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ["https://explorer.ritualfoundation.org/"]
        }
      ]
    });
  }
  const browserProvider = new BrowserProvider(window.ethereum);
  const signer = await browserProvider.getSigner();
  walletAddress = await signer.getAddress();
  writeContract = new Contract(contractAddress, tribunalAbi, signer);
  if (connectButton) connectButton.textContent = shortHash(walletAddress, 6, 4);
  if (walletNode) walletNode.textContent = shortHash(walletAddress, 6, 4);
  setStatus(`Account connected: ${shortHash(walletAddress, 6, 4)}`);
  updateCommitmentPreview();
  return writeContract;
}

async function getWriteContract() {
  return writeContract ?? ensureWallet();
}

async function readBounty(id: number): Promise<BountyRecord | null> {
  if (!readContract) return null;
  const record = await readContract.bounties(id);
  if (record.creator === ZeroAddress) return null;
  return {
    id,
    creator: record.creator,
    promptCid: record.promptCid,
    promptHash: record.promptHash,
    commitDeadline: Number(record.commitDeadline),
    revealDeadline: Number(record.revealDeadline),
    judged: Boolean(record.judged),
    finalized: Boolean(record.finalized),
    llmInputHash: record.llmInputHash,
    winnerIndex: record.winnerIndex,
    winnerSubmissionId: record.winnerSubmissionId,
    winner: record.winner,
    commitmentCount: record.commitmentCount,
    revealCount: record.revealCount
  };
}

async function loadBounties() {
  if (!readContract) {
    bounties = [];
    activeBountyId = 0;
    setStatus("No blind tribunal contract address configured.");
    render();
    return;
  }

  setStatus("Reading Ritual testnet...");
  const nextId = Number(await readContract.nextBountyId());
  const records = await Promise.all(Array.from({ length: Math.max(0, nextId - 1) }, (_, index) => readBounty(index + 1)));
  bounties = records.filter((record): record is BountyRecord => Boolean(record));
  if (!bounties.some((record) => record.id === activeBountyId)) activeBountyId = bounties[0]?.id ?? 0;
  if (nextIdNode) nextIdNode.textContent = String(nextId);
  if (countNode) countNode.textContent = String(bounties.length);
  setStatus(`${bounties.length} onchain case${bounties.length === 1 ? "" : "s"} loaded.`);
  render();
}

function renderBounties() {
  if (!bountyList || !inspector) return;
  if (!bounties.length) {
    bountyList.innerHTML = `
      <div class="no-cases">
        <span>empty docket</span>
        <strong>No onchain cases found</strong>
        <p>${contractAddress ? "Connect an account and open the first case." : "Deploy with wallet 2 and set VITE_BLIND_TRIBUNAL_ADDRESS first."}</p>
      </div>
    `;
    inspector.innerHTML = `
      <span class="case-phase">Waiting</span>
      <h3>Contract storage only</h3>
      <p>This interface does not render preset cases. Rows appear only after createBounty writes to chain.</p>
      <code>${escapeHtml(contractAddress || "VITE_BLIND_TRIBUNAL_ADDRESS is empty")}</code>
    `;
    return;
  }

  bountyList.innerHTML = bounties
    .map(
      (record) => `
        <button class="docket-row ${record.id === activeBountyId ? "active" : ""}" type="button" data-bounty="${record.id}">
          <span class="row-id">#${escapeHtml(record.id)}</span>
          <span class="row-phase">${escapeHtml(phaseOf(record))}</span>
          <strong>${escapeHtml(shortHash(record.promptHash, 12, 8))}</strong>
          <small>${escapeHtml(record.commitmentCount)} seals / ${escapeHtml(record.revealCount)} reveals</small>
        </button>
      `
    )
    .join("");

  const active = bounties.find((record) => record.id === activeBountyId) ?? bounties[0];
  inspector.innerHTML = `
    <span class="case-phase">${escapeHtml(phaseOf(active))}</span>
    <h3>Case #${escapeHtml(active.id)}</h3>
    <dl>
      <div><dt>Creator</dt><dd>${escapeHtml(shortHash(active.creator))}</dd></div>
      <div><dt>Commit closes</dt><dd>${escapeHtml(timeLabel(active.commitDeadline))}</dd></div>
      <div><dt>Reveal closes</dt><dd>${escapeHtml(timeLabel(active.revealDeadline))}</dd></div>
      <div><dt>Winner</dt><dd>${escapeHtml(active.winner === ZeroAddress ? "not finalized" : shortHash(active.winner))}</dd></div>
    </dl>
    <code>prompt ${escapeHtml(shortHash(active.promptHash, 14, 12))}</code>
    <code>batch ${escapeHtml(zeroHash(active.llmInputHash) ? "not judged" : shortHash(active.llmInputHash, 14, 12))}</code>
    <a href="${escapeHtml(active.promptCid)}" target="_blank" rel="noreferrer">${escapeHtml(active.promptCid)}</a>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-bounty]").forEach((button) => {
    button.addEventListener("click", () => {
      activeBountyId = Number(button.dataset.bounty ?? 0);
      render();
    });
  });
}

function render() {
  renderBounties();
}

async function submitTx(form: HTMLFormElement, action: () => Promise<{ hash: string; wait: () => Promise<unknown> }>) {
  const submitter = document.activeElement instanceof HTMLButtonElement ? document.activeElement : form.querySelector<HTMLButtonElement>("button[type='submit']");
  const previous = submitter?.textContent ?? "";
  try {
    if (submitter) {
      submitter.disabled = true;
      submitter.textContent = "Waiting for account...";
    }
    const tx = await action();
    setStatus(`Transaction sent: ${shortHash(tx.hash, 8, 6)}`);
    if (submitter) submitter.textContent = "Confirming...";
    await tx.wait();
    await loadBounties();
  } catch (error) {
    setStatus(error instanceof Error ? error.message.slice(0, 180) : "Transaction failed.");
  } finally {
    if (submitter) {
      submitter.disabled = false;
      submitter.textContent = previous;
    }
  }
}

connectButton?.addEventListener("click", () => {
  ensureWallet().catch((error) => setStatus(error instanceof Error ? error.message : "Account connection failed."));
});

refreshButton?.addEventListener("click", () => {
  loadBounties().catch((error) => setStatus(error instanceof Error ? error.message : "Refresh failed."));
});

submitForm?.addEventListener("input", updateCommitmentPreview);

createForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const promptCid = readFormValue(createForm, "promptCid");
  const promptText = readFormValue(createForm, "promptText");
  const commitMinutes = Math.max(1, readFormNumber(createForm, "commitMinutes"));
  const revealMinutes = Math.max(1, readFormNumber(createForm, "revealMinutes"));
  submitTx(createForm, async () => {
    const latest = await readProvider.getBlock("latest");
    const rawTimestamp = BigInt(latest?.timestamp ?? 0);
    const now = rawTimestamp > 10_000_000_000n ? rawTimestamp / 1_000n : rawTimestamp;
    const commitDeadline = now + BigInt(commitMinutes * 60);
    const revealDeadline = commitDeadline + BigInt(revealMinutes * 60);
    return (await getWriteContract()).createBounty(promptCid, keccak256(toUtf8Bytes(promptText)), commitDeadline, revealDeadline);
  });
});

submitForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitter = event.submitter as HTMLButtonElement | null;
  const action = submitter?.value ?? "";
  const bountyId = BigInt(Math.max(1, Math.floor(readFormNumber(submitForm, "bountyId") || 1)));
  const answer = readFormValue(submitForm, "answer");
  const salt = normalizeSalt(readFormValue(submitForm, "salt"));
  submitTx(submitForm, async () => {
    const contract = await getWriteContract();
    if (!isAddress(walletAddress)) throw new Error("Connect account first.");
    if (action === "commit") return contract.submitCommitment(bountyId, computeCommitment(answer, salt, walletAddress, bountyId));
    if (action === "reveal") return contract.revealAnswer(bountyId, answer, salt);
    throw new Error("Unknown action.");
  });
});

judgeForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitter = event.submitter as HTMLButtonElement | null;
  const action = submitter?.value ?? "";
  const bountyId = BigInt(Math.max(1, Math.floor(readFormNumber(judgeForm, "bountyId") || 1)));
  const winnerIndex = BigInt(Math.max(0, Math.floor(readFormNumber(judgeForm, "winnerIndex") || 0)));
  const llmInput = readFormValue(judgeForm, "llmInput");
  submitTx(judgeForm, async () => {
    const contract = await getWriteContract();
    if (action === "judge") return contract.judgeAll(bountyId, hexlify(toUtf8Bytes(llmInput)));
    if (action === "finalize") return contract.finalizeWinner(bountyId, winnerIndex);
    throw new Error("Unknown action.");
  });
});

window.ethereum?.on?.("accountsChanged", () => {
  walletAddress = "";
  writeContract = null;
  if (connectButton) connectButton.textContent = "Connect Account";
  if (walletNode) walletNode.textContent = "none";
  updateCommitmentPreview();
  setStatus("Account changed.");
});

window.ethereum?.on?.("chainChanged", () => {
  window.location.reload();
});

render();
loadBounties().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Could not read blind tribunal.");
  render();
});
