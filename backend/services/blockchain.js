import fs from 'node:fs';
import { ethers } from 'ethers';

// Read the existing artifact; no contract address, function ABI, or contract changes.
export const artifact = JSON.parse(fs.readFileSync(new URL('../../contracts/artifacts/contracts/HealthVault.sol/HealthVault.json', import.meta.url), 'utf8'));
export const eventInterface = new ethers.Interface(artifact.abi);
export const SEPOLIA_CHAIN_ID = 11155111;
const eventTopics = ['RecordUploaded', 'AccessGranted', 'AccessRevoked'].map(name => eventInterface.getEvent(name).topicHash);

export function createBlockchainReader({ provider, address, expectedRuntime = artifact.deployedBytecode }) {
  async function verify() {
    if (!ethers.isAddress(address)) throw new Error('Contract address is not configured correctly.');
    const [network, code] = await Promise.all([provider.getNetwork(), provider.getCode(address)]);
    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) throw new Error('Audit RPC is not connected to Sepolia.');
    if (code.toLowerCase() !== expectedRuntime.toLowerCase()) throw new Error('Deployed contract does not match the verified local artifact.');
  }
  async function logsFor(fromBlock, toBlock) {
    try { return await provider.getLogs({ address, fromBlock, toBlock, topics: [eventTopics] }); }
    catch (error) {
      // Some RPC plans restrict log ranges. Split only range-limit errors, never auth/network failures.
      const message = String(error?.error?.message || error?.info?.error?.message || error.message);
      if (fromBlock < toBlock && /block range|range.*limit|too many results|response size|query returned more/i.test(message)) {
        const middle = Math.floor((fromBlock + toBlock) / 2);
        return [...await logsFor(fromBlock, middle), ...await logsFor(middle + 1, toBlock)];
      }
      throw new Error('Sepolia events could not be loaded. Retry when the RPC service is available.');
    }
  }
  return {
    async read({ wallet, toBlock, fromBlock }) {
      await verify();
      const latest = await provider.getBlockNumber();
      const to = toBlock === undefined ? latest : Math.min(toBlock, latest);
      const from = fromBlock === undefined ? Math.max(0, to - 199) : fromBlock;
      if (from > to || to - from > 1999) throw new Error('Choose a range of at most 2,000 blocks ending at or before the latest block.');
      const logs = await logsFor(from, to);
      const blocks = new Map();
      const transactions = new Map();
      const receipts = new Map();
      const events = [];
      for (const log of logs) {
        if (log.removed) continue;
        const parsed = eventInterface.parseLog(log);
        const patient = parsed.args.patient.toLowerCase();
        const doctor = parsed.args.doctor?.toLowerCase() || null;
        // Upload events omit the uploader; use the real transaction sender.
        let actor = patient;
        if (parsed.name === 'RecordUploaded') {
          if (!transactions.has(log.transactionHash)) transactions.set(log.transactionHash, await provider.getTransaction(log.transactionHash));
          actor = transactions.get(log.transactionHash)?.from?.toLowerCase() || null;
        }
        if (![patient, doctor, actor].includes(wallet.toLowerCase())) continue;
        if (!blocks.has(log.blockNumber)) blocks.set(log.blockNumber, await provider.getBlock(log.blockNumber));
        const block = blocks.get(log.blockNumber);
        // Do not mix logs and block timestamps from different sides of a reorganization.
        if (!block || block.hash !== log.blockHash) throw new Error('Chain changed while reading events. Refresh to retry.');
        if (!receipts.has(log.transactionHash)) {
          // A receipt outage must not turn an observed event into a claimed success.
          let receipt = null;
          try { receipt = await provider.getTransactionReceipt(log.transactionHash); } catch { /* Report unverified status below. */ }
          receipts.set(log.transactionHash, receipt);
        }
        const receipt = receipts.get(log.transactionHash);
        if (receipt && (receipt.hash !== log.transactionHash || receipt.blockHash !== log.blockHash || receipt.blockNumber !== log.blockNumber || receipt.status === 0)) {
          throw new Error('Transaction receipt does not match the observed event. Refresh to retry.');
        }
        events.push({
          id: `${SEPOLIA_CHAIN_ID}:${log.blockHash}:${log.transactionHash}:${log.index}`,
          source: 'blockchain', action: parsed.name, actor, patient, doctor,
          timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
          transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash,
          transactionStatus: receipt?.status === 1 ? 'success' : 'unknown',
          logIndex: log.index, outcome: 'included', confirmations: latest - log.blockNumber + 1,
        });
      }
      return { events, coverage: { fromBlock: from, toBlock: to, latestBlock: latest, nextToBlock: from > 0 ? from - 1 : null, chainId: SEPOLIA_CHAIN_ID, address } };
    },
  };
}

let reader;
let sharedProvider;
function getProvider() {
  if (!sharedProvider) {
    if (!process.env.ALCHEMY_URL) throw new Error('Audit RPC is not configured.');
    const request = new ethers.FetchRequest(process.env.ALCHEMY_URL);
    request.timeout = 12000;
    sharedProvider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  }
  return sharedProvider;
}
export function getBlockchainReader() {
  if (!reader) {
    reader = createBlockchainReader({ provider: getProvider(), address: process.env.CONTRACT_ADDRESS });
  }
  return reader;
}

export async function readCurrentAccess(patient, doctor) {
  const provider = getProvider();
  if (Number((await provider.getNetwork()).chainId) !== SEPOLIA_CHAIN_ID) throw new Error('Incorrect network');
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, artifact.abi, provider);
  // Explicit latest block reads current contract state, not a client-reported consent flag.
  return contract.hasAccess(patient, doctor, { blockTag: 'latest' });
}
