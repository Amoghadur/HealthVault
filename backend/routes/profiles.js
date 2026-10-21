import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { createDoctorProfileStore, normalizeProfileWallet, validateProfileFields } from '../services/doctorProfileStore.js';

export function createProfileRouter({ store = createDoctorProfileStore() } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { req.profileWallet = normalizeProfileWallet(req.user.address); }
    catch { return res.status(401).json({ error: 'Invalid wallet session.' }); }
    next();
  });
  router.get('/me', (req, res) => {
    try { res.json({ profile: store.get(req.profileWallet) }); }
    catch { res.status(503).json({ error: 'Profile storage unavailable. Please retry.' }); }
  });
  router.put('/me', (req, res) => {
    let fields;
    try { fields = validateProfileFields(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { res.json({ profile: store.save(req.profileWallet, fields) }); }
    catch { res.status(503).json({ error: 'Profile could not be saved. Please retry.' }); }
  });
  return router;
}
export default createProfileRouter();
