import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { auditStore } from '../services/auditStore.js';
import { getBlockchainReader } from '../services/blockchain.js';

export function createAuditRouter({ store = auditStore, getReader = getBlockchainReader, auth = requireAuth } = {}) {
  const router = express.Router();
  router.get('/', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const range = {};
    for (const key of ['fromBlock', 'toBlock']) {
      if (req.query[key] !== undefined) {
        if (!/^\d+$/.test(req.query[key]) || !Number.isSafeInteger(Number(req.query[key]))) return res.status(400).json({ error: 'Block numbers must be non-negative integers.' });
        range[key] = Number(req.query[key]);
      }
    }
    if (range.fromBlock !== undefined && (range.toBlock === undefined || range.fromBlock > range.toBlock || range.toBlock - range.fromBlock > 1999)) return res.status(400).json({ error: 'Provide a valid range of at most 2,000 blocks.' });
    const warnings = [];
    let backend = [], blockchain = [], coverage = null;
    try { backend = store.read(req.user.address); }
    catch { warnings.push('Backend audit is unavailable or incomplete. No missing activity has been inferred.'); }
    try {
      const result = await getReader().read({ wallet: req.user.address, ...range });
      blockchain = result.events;
      coverage = result.coverage;
    } catch {
      warnings.push('Blockchain history is unavailable. Retry or check the Sepolia RPC configuration.');
    }
    res.json({ events: [...backend, ...blockchain].sort((a, b) => b.timestamp.localeCompare(a.timestamp)), coverage, warnings,
      backendNotice: 'Backend activity starts when audit logging was enabled. It records server actions, not proof that a person read a record. Backend logs are not immutable blockchain events.' });
  });
  return router;
}
export default createAuditRouter();
