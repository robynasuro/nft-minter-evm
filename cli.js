// cli.js — FINAL FAST RPC + PUBLIC/WHITELIST/GTD MODES
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const axios = require("axios");
const inquirer = require("inquirer");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (arr) => [...new Set(arr)];

// ===== ENV =====
const ENV = {
  RPC_URL: process.env.RPC_URL || "",                   // bisa multiple, pisah koma
  CHAIN_ID: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined,
  CONTRACT: process.env.CONTRACT || "",
  FUNCTION_NAME: process.env.FUNCTION_NAME || "mint",   // default nama fungsi
  AMOUNT: process.env.AMOUNT || "1",
  PRICE_ETH: process.env.PRICE_ETH || "0",
  GAS_LIMIT: process.env.GAS_LIMIT || "300000",
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",
};

// ===== Explorer link =====
function txExplorer(rpc, txHash) {
  const map = {
    sepolia: "https://sepolia.etherscan.io/tx/",
    mainnet: "https://etherscan.io/tx/",
    base: "https://basescan.org/tx/",
    "base-sepolia": "https://sepolia.basescan.org/tx/",
    polygon: "https://polygonscan.com/tx/",
    bsc: "https://bscscan.com/tx/",
    monad: "https://explorer.monad.xyz/tx/",
  };
  const u = rpc.toLowerCase();
  for (const k of Object.keys(map)) if (u.includes(k)) return map[k] + txHash;
  return null;
}

// ===== Fallback Provider (fast RPC; Ankr dulu) =====
function makeProvider(rpcInput, chainId) {
  if (!rpcInput) throw new Error("RPC_URL kosong.");
  const urls = rpcInput.split(",").map(s => s.trim()).filter(Boolean);
  // priority lebih kecil = lebih prioritas; weight default 1
  const providers = urls.map((url, i) => ({
    provider: new ethers.providers.StaticJsonRpcProvider(
      { url, timeout: 12000 },
      chainId ? { name: "custom", chainId: Number(chainId) } : undefined
    ),
    priority: i, weight: 1, stallTimeout: 2000 // nunggu 2s lalu coba provider berikutnya
  }));
  if (providers.length === 1) return providers[0].provider;
  return new ethers.providers.FallbackProvider(providers, 1); // quorum 1
}

// ===== Denylist alamat non-NFT (router/token/infra) =====
const DENYLIST = new Set(
  [
    "0x00005ea00ac477b1030ce78506496e8c2de24bf5", // OpenSea router/conduit
    "0x0000a26b00c1f0df003000390027140000faa719", // OpenSea conduit
    // tokens / infra umum:
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", // WETH Polygon
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC Base
    "0x4200000000000000000000000000000000000006", // WETH Base
    "0x4300000000000000000000000000000000000003",
    "0x4300000000000000000000000000000000000004",
    "0x0000000000000000000000000000000000000000",
    "0x6969696969696969696969696969696969696969",
  ].map((x) => x.toLowerCase())
);

// ===== On-chain NFT check =====
async function isNftContract(addr, provider) {
  const erc165Abi = [
    "function supportsInterface(bytes4 interfaceId) view returns (bool)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
  ];
  const c = new ethers.Contract(addr, erc165Abi, provider);
  try { if (await c.supportsInterface("0x80ac58cd")) return { isNFT: true, std: "ERC721" }; } catch (_) {}
  try { if (await c.supportsInterface("0xd9b67a26")) return { isNFT: true, std: "ERC1155" }; } catch (_) {}
  try { await c.name(); await c.symbol(); return { isNFT: true, std: "UNKNOWN" }; } catch (_) {}
  return { isNFT: false, std: null };
}

// ===== HTML scrape + on-chain filter + ranking =====
async function detectContractsFromUrl(url, rpc, chainId) {
  const out = { top: null, nftCandidates: [], hints: {} };
  const res = await axios.get(url, { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" } });
  const html = String(res.data);

  const raw = (html.match(/0x[a-fA-F0-9]{40}/g) || []).map((a) => a.toLowerCase());
  const freq = raw.reduce((m, a) => ((m[a] = (m[a] || 0) + 1), m), {});
  let sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);

  const hints = [];
  if (/opensea/i.test(url)) {
    const os = (html.match(/"address"\s*:\s*"0x[a-fA-F0-9]{40}"/g) || [])
      .map((x) => x.match(/0x[a-fA-F0-9]{40}/)[0].toLowerCase());
    if (os.length) out.hints.opensea = uniq(os);
    hints.push(...os);
  }
  if (/magiceden/i.test(url)) {
    const me = (html.match(/"contractAddress"\s*:\s*"0x[a-fA-F0-9]{40}"/g) || [])
      .map((x) => x.match(/0x[a-fA-F0-9]{40}/)[0].toLowerCase());
    if (me.length) out.hints.magiceden = uniq(me);
    hints.push(...me);
  }

  const merged = uniq([...sorted, ...hints]).filter((a) => !DENYLIST.has(a));

  const provider = makeProvider(rpc, chainId);
  const nftChecks = [];
  for (const a of merged) {
    try {
      const resC = await isNftContract(a, provider);
      if (resC.isNFT) {
        const score = (freq[a] || 0) + (hints.includes(a) ? 3 : 0);
        nftChecks.push({ addr: a, std: resC.std, score });
      }
    } catch (_) {}
  }

  nftChecks.sort((x, y) => y.score - x.score);
  out.nftCandidates = nftChecks;
  out.top = nftChecks.length ? nftChecks[0].addr : null;
  return out;
}

// ===== ABI pools (flexible sesuai mode) =====
const ABI_PUBLIC = [
  "function mint(uint256 amount) public payable",
  "function publicMint(uint256 amount) public payable",
];
const ABI_WL_MERKLE = [
  "function mintWhitelist(uint256 amount, bytes32[] proof) public payable",
  "function whitelistMint(uint256 amount, bytes32[] proof) public payable",
];
const ABI_WL_SIG = [
  "function mint(uint256 amount, bytes signature) public payable",
  "function publicMint(uint256 amount, bytes signature) public payable",
];
const ABI_GTD = [
  "function mint(uint256 amount, uint256 maxOrNonce, bytes signature) public payable",
  "function publicMint(uint256 amount, uint256 maxOrNonce, bytes signature) public payable",
];

// ===== Preflight: cek balance & estimasi =====
async function preflightChecks({ provider, wallet, callFn, overrides }) {
  const [bal, fee] = await Promise.all([wallet.getBalance(), provider.getFeeData()]);
  const maxFeePerGas = fee.maxFeePerGas || fee.gasPrice || ethers.utils.parseUnits("5", "gwei");
  let gasLimit = overrides.gasLimit ? ethers.BigNumber.from(overrides.gasLimit) : undefined;

  // coba estimateGas
  try {
    const est = await callFn({ maxFeePerGas, ...overrides }, true);
    if (est && ethers.BigNumber.isBigNumber(est)) {
      gasLimit = gasLimit && gasLimit.gt(est) ? gasLimit : est.mul(120).div(100);
    }
  } catch (_) { /* ignore */ }

  const value = overrides.value || ethers.constants.Zero;
  const gasCost = gasLimit ? gasLimit.mul(maxFeePerGas) : ethers.constants.Zero;
  const needed = value.add(gasCost);

  return {
    balance: bal,
    needed,
    gasLimit: gasLimit || (overrides.gasLimit ? ethers.BigNumber.from(overrides.gasLimit) : ethers.BigNumber.from("300000")),
    maxFeePerGas,
    insufficient: bal.lt(needed),
  };
}

// ===== Build contract + call per mode =====
function buildContractAndCaller({ mode, provider, pk, contractAddr, fnName }) {
  let abi;
  if (mode === "public") abi = ABI_PUBLIC;
  else if (mode === "wl-merkle") abi = ABI_WL_MERKLE;
  else if (mode === "wl-sig") abi = ABI_WL_SIG;
  else if (mode === "gtd") abi = ABI_GTD;
  else throw new Error("Mode mint tidak dikenal.");

  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(contractAddr, abi, wallet);

  return { wallet, contract, fnName };
}

// ===== Mint core (loop optional) =====
async function mintWithRetry({
  rpc, chainId, contractAddr, fnName, mode, amount, priceEth, gasLimit, pk,
  proofArr, signature, maxOrNonce, loop = true, retryDelay = 3000, forceOnRevert = false
}) {
  const provider = makeProvider(rpc, chainId);
  const { wallet, contract } = buildContractAndCaller({ mode, provider, pk, contractAddr, fnName });

  const amountBN = ethers.BigNumber.from(amount);
  const value = ethers.utils.parseEther(priceEth).mul(amountBN);

  // helper untuk estimateGas terpadu
  const callBuilder = (over, estimateOnly = false) => {
    if (mode === "public") {
      const args = [amountBN, over];
      return estimateOnly ? contract.estimateGas[fnName](...args) : contract[fnName](...args);
    }
    if (mode === "wl-merkle") {
      const args = [amountBN, proofArr || [], over];
      return estimateOnly ? contract.estimateGas[fnName](...args) : contract[fnName](...args);
    }
    if (mode === "wl-sig") {
      const args = [amountBN, signature, over];
      return estimateOnly ? contract.estimateGas[fnName](...args) : contract[fnName](...args);
    }
    if (mode === "gtd") {
      const mo = ethers.BigNumber.from(maxOrNonce || 0);
      const args = [amountBN, mo, signature, over];
      return estimateOnly ? contract.estimateGas[fnName](...args) : contract[fnName](...args);
    }
  };

  // Preflight
  const pre = await preflightChecks({
    provider,
    wallet,
    overrides: { value, gasLimit },
    callFn: (over, estimateOnly) => callBuilder(over, estimateOnly),
  });

  if (pre.insufficient) {
    console.error(`❌ Insufficient balance. Need ~${ethers.utils.formatEther(pre.needed)} native (value+gas), balance ${ethers.utils.formatEther(pre.balance)}.`);
    return;
  }

  let done = false;
  while (!done) {
    try {
      console.log(`\n[${wallet.address}] Mode=${mode} | amount=${amount} | priceEach=${priceEth}`);
      const tx = await callBuilder({
        value,
        gasLimit: pre.gasLimit,
        maxFeePerGas: pre.maxFeePerGas,
      }, false);
      console.log(`[${wallet.address}] Tx sent: ${tx.hash}`);
      const rc = await tx.wait();
      if (rc.status === 1) {
        console.log(`[${wallet.address}] ✅ SUCCESS: ${rc.transactionHash}`);
        const link = txExplorer(rpc, tx.hash);
        if (link) console.log(`[${wallet.address}] 🔗 ${link}`);
        done = true;
      } else {
        console.error(`[${wallet.address}] ❌ TX reverted`);
        if (!loop) break;
        await sleep(retryDelay);
      }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.error(`[${wallet.address}] ❌ Error: ${msg}`);
      if (!loop || (!forceOnRevert && /revert|execution reverted|CALL_EXCEPTION/i.test(msg))) break;
      await sleep(retryDelay);
    }
  }
}

// ===== Detect (OpenSea/MagicEden) dengan on-chain verify =====
async function detectContractsFromUrl(url, rpc, chainId) {
  const out = { top: null, nftCandidates: [], hints: {} };
  const res = await axios.get(url, { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" } });
  const html = String(res.data);

  const raw = (html.match(/0x[a-fA-F0-9]{40}/g) || []).map((a) => a.toLowerCase());
  const freq = raw.reduce((m, a) => ((m[a] = (m[a] || 0) + 1), m), {});
  let sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);

  const hints = [];
  if (/opensea/i.test(url)) {
    const os = (html.match(/"address"\s*:\s*"0x[a-fA-F0-9]{40}"/g) || [])
      .map((x) => x.match(/0x[a-fA-F0-9]{40}/)[0].toLowerCase());
    if (os.length) out.hints.opensea = uniq(os);
    hints.push(...os);
  }
  if (/magiceden/i.test(url)) {
    const me = (html.match(/"contractAddress"\s*:\s*"0x[a-fA-F0-9]{40}"/g) || [])
      .map((x) => x.match(/0x[a-fA-F0-9]{40}/)[0].toLowerCase());
    if (me.length) out.hints.magiceden = uniq(me);
    hints.push(...me);
  }

  const merged = uniq([...sorted, ...hints]).filter((a) => !DENYLIST.has(a));
  const provider = makeProvider(rpc, chainId);

  const nftChecks = [];
  for (const a of merged) {
    try {
      const resC = await isNftContract(a, provider);
      if (resC.isNFT) {
        const score = (freq[a] || 0) + (hints.includes(a) ? 3 : 0);
        nftChecks.push({ addr: a, std: resC.std, score });
      }
    } catch (_) {}
  }

  nftChecks.sort((x, y) => y.score - x.score);
  out.nftCandidates = nftChecks;
  out.top = nftChecks.length ? nftChecks[0].addr : null;
  return out;
}

// ===== Multi-wallet =====
async function runMultiMint(cfg, keysPath = "./keys.txt") {
  if (!fs.existsSync(keysPath)) throw new Error("keys.txt tidak ditemukan.");
  const keys = fs.readFileSync(keysPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const pk of keys) {
    try {
      await mintWithRetry({ ...cfg, pk });
      await sleep(800);
    } catch (e) {
      console.error(`❌ Wallet ${pk.slice(0, 12)}... gagal: ${e.message}`);
    }
  }
}

// ===== CLI =====
async function main() {
  console.log("=== NFT Minter (FAST RPC) + Auto Accurate Detector + Multi Mint Modes ===");

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "Pilih aksi",
    choices: [
      { name: "Detect contract address (OpenSea/MagicEden + on-chain verify)", value: "detect" },
      { name: "Mint (Single wallet)", value: "single" },
      { name: "Mint (Multi-wallet keys.txt)", value: "multi" },
      { name: "Keluar", value: "quit" },
    ],
  }]);

  if (action === "quit") return;

  if (action === "detect") {
    const { url } = await inquirer.prompt([{ name: "url", message: "URL koleksi/launchpad:" }]);
    const { rpc, chainId } = await inquirer.prompt([
      { name: "rpc", message: "RPC URL (bisa banyak, pisah koma; Ankr di depan untuk tercepat)", default: ENV.RPC_URL || "" },
      { name: "chainId", message: "Chain ID (opsional)", default: ENV.CHAIN_ID || "" },
    ]);
    const cid = chainId ? Number(chainId) : undefined;
    try {
      const result = await detectContractsFromUrl(url, rpc, cid);
      console.log("\n🔍 Kandidat NFT (sudah difilter on-chain):");
      if (!result.nftCandidates.length) {
        console.log("— Tidak ditemukan kontrak NFT valid. Coba URL halaman mint langsung / tambah RPC lain.");
      } else {
        result.nftCandidates.forEach((o, i) => {
          const tags = [o.std];
          if (result.top === o.addr) tags.push("TOP");
          console.log(`${i + 1}. ${o.addr}  [${tags.join(", ")}]  score=${o.score}`);
        });
        console.log(`\n✅ Rekomendasi TERATAS: ${result.top}`);
      }
    } catch (e) {
      console.error("Gagal deteksi:", e.message);
    }
    return;
  }

  // Mint flow — input umum
  const baseInput = await inquirer.prompt([
    { name: "rpc", message: "RPC URL (bisa banyak, pisah koma; Ankr di depan)", default: ENV.RPC_URL || "" },
    { name: "chainId", message: "Chain ID (opsional)", default: ENV.CHAIN_ID || "" },
    { name: "contractAddr", message: "Alamat kontrak", default: ENV.CONTRACT || "" },
    {
      type: "list",
      name: "mode",
      message: "Pilih mode mint",
      choices: [
        { name: "Public (mint(amount))", value: "public" },
        { name: "Whitelist (Merkle proof)", value: "wl-merkle" },
        { name: "Whitelist (Signature)", value: "wl-sig" },
        { name: "GTD / Guaranteed (amount,maxOrNonce,signature)", value: "gtd" },
      ],
      default: "public",
    },
    { name: "fnName", message: "Nama fungsi mint", default: ENV.FUNCTION_NAME || "mint" },
    { name: "amount", message: "Jumlah NFT per tx", default: ENV.AMOUNT || "1" },
    { name: "priceEth", message: "Harga per NFT", default: ENV.PRICE_ETH || "0" },
    { name: "gasLimit", message: "Gas limit (override; kosongkan biar auto-estimate)", default: ENV.GAS_LIMIT || "" },
    { type: "confirm", name: "loop", message: "Auto loop jika gagal?", default: true },
    { name: "retryDelay", message: "Delay retry (ms)", default: "3000" },
    { type: "confirm", name: "forceOnRevert", message: "Tetap retry kalau revert (sold out/paused/whitelist)?", default: false },
    { name: "pk", message: "Private key", default: ENV.PRIVATE_KEY || "" },
  ]);

  if (!baseInput.contractAddr) {
    console.log("⚠️  Alamat kontrak kosong. Jalankan menu Detect dulu.");
    return;
  }
  if (!baseInput.pk) throw new Error("Private key kosong.");

  // Tambahan argumen sesuai mode
  let proofArr = [];
  let signature = "0x";
  let maxOrNonce = "0";

  if (baseInput.mode === "wl-merkle") {
    const { proofCsv } = await inquirer.prompt([
      { name: "proofCsv", message: "Merkle proof (comma-separated hex, mis: 0xabc,0xdef):", default: "" },
    ]);
    proofArr = proofCsv
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  } else if (baseInput.mode === "wl-sig") {
    const { sig } = await inquirer.prompt([{ name: "sig", message: "Signature (0x…):", default: "" }]);
    signature = sig;
  } else if (baseInput.mode === "gtd") {
    const args = await inquirer.prompt([
      { name: "maxOrNonce", message: "maxOrNonce (uint256):", default: "0" },
      { name: "sig", message: "Signature (0x…):", default: "" },
    ]);
    maxOrNonce = args.maxOrNonce;
    signature = args.sig;
  }

  const cfg = {
    rpc: baseInput.rpc,
    chainId: baseInput.chainId ? Number(baseInput.chainId) : undefined,
    contractAddr: baseInput.contractAddr,
    fnName: baseInput.fnName,
    mode: baseInput.mode,
    amount: baseInput.amount,
    priceEth: baseInput.priceEth,
    gasLimit: baseInput.gasLimit || undefined,
    loop: baseInput.loop,
    retryDelay: parseInt(baseInput.retryDelay, 10),
    forceOnRevert: baseInput.forceOnRevert,
    pk: baseInput.pk,
    proofArr,
    signature,
    maxOrNonce,
  };

  if (action === "single") {
    await mintWithRetry(cfg);
  } else if (action === "multi") {
    const { keysPath } = await inquirer.prompt([{ name: "keysPath", message: "Path keys.txt", default: "./keys.txt" }]);
    await runMultiMint(cfg, keysPath);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
