// Read-only integration check. Prints only public event counts and block coverage.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ethers } = require('../backend/node_modules/ethers');
const dotenv = require('../backend/node_modules/dotenv');
const root = path.resolve(__dirname, '..');
let stage = 'reading local configuration';
(async () => {
  const env = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
  const request = new ethers.FetchRequest(env.ALCHEMY_URL);
  request.timeout = 15000;
  const provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  try {
    const { createBlockchainReader } = await import(pathToFileURL(path.join(root, 'backend/services/blockchain.js')));
    const reader = createBlockchainReader({ provider, address: env.CONTRACT_ADDRESS });
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'backend/uploads/records_metadata.json')));
    stage = 'reading the Sepolia head';
    const head = await provider.getBlockNumber();
    // Upload timestamps only choose windows to search; they are never represented as chain event times.
    for (const record of metadata.slice(-2)) {
      const timestamp = Math.floor(new Date(record.uploadedAt).getTime() / 1000);
      if (!Number.isFinite(timestamp)) continue;
      let low = 0, high = head;
      stage = 'locating a historical block window';
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const block = await provider.getBlock(middle);
        if (block.timestamp < timestamp) low = middle + 1; else high = middle;
      }
      stage = 'verifying contract, events and receipts';
      const result = await reader.read({ wallet: record.patientAddress, fromBlock: Math.max(0, low - 5), toBlock: Math.min(head, low + 94) });
      const counts = {};
      for (const event of result.events) counts[event.action] = (counts[event.action] || 0) + 1;
      const verifiedReceipts = result.events.filter(event => event.transactionStatus === 'success').length;
      console.log(JSON.stringify({ coverage: result.coverage, genuineEventCounts: counts, verifiedReceipts }));
    }
  } finally { provider.destroy(); }
})().catch(error => {
  const safeCodes = ['TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR', 'BAD_DATA', 'UNKNOWN_ERROR'];
  const code = safeCodes.includes(error.code) ? error.code : 'CHECK_FAILED';
  const safeReasons = [
    'Transaction receipt does not match the observed event. Refresh to retry.',
    'Chain changed while reading events. Refresh to retry.',
    'Deployed contract does not match the verified local artifact.',
    'Audit RPC is not connected to Sepolia.',
    'Sepolia events could not be loaded. Retry when the RPC service is available.',
  ];
  console.error(`Read-only audit check failed while ${stage} (${code}). ${safeReasons.includes(error.message) ? error.message : 'No private RPC details were printed.'}`);
  process.exitCode = 1;
});
