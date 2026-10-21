import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  defaultPatientProfileStore,
  normalizePatientWallet,
  validatePatientProfileFields,
} from '../services/patientProfileStore.js';
import { readCurrentAccess } from '../services/blockchain.js';
import { defaultExpiryStore } from '../services/consentExpiryStore.js';
import { createPatientProfileRateLimiter } from '../middleware/rateLimiting.js';

export function createPatientRouter({
  store = defaultPatientProfileStore,
  hasAccess = readCurrentAccess,
  expiryStore = defaultExpiryStore,
  patientProfileRateLimiter = createPatientProfileRateLimiter(),
} = {}) {
  const router = express.Router();
  router.use(requireAuth);

  // Set no-store on all responses
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      req.profileWallet = normalizePatientWallet(req.user.address);
    } catch {
      return res.status(401).json({ error: 'Invalid wallet session.' });
    }
    next();
  });

  // GET /profile - Patient reads own profile
  router.get('/profile', patientProfileRateLimiter, (req, res) => {
    try {
      const profile = store.get(req.profileWallet);
      res.json({ profile });
    } catch {
      res.status(503).json({ error: 'Patient profile storage unavailable. Please retry.' });
    }
  });

  // POST /profile & PUT /profile - Patient updates own profile
  const handleSave = (req, res) => {
    let fields;
    try {
      fields = validatePatientProfileFields(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    try {
      const profile = store.save(req.profileWallet, fields);
      res.json({ profile });
    } catch {
      res.status(503).json({ error: 'Patient profile could not be saved. Please retry.' });
    }
  };

  router.post('/profile', patientProfileRateLimiter, handleSave);
  router.put('/profile', patientProfileRateLimiter, handleSave);

  // GET /profile/public/:address - Care provider reads public profile (displayName, avatar only)
  // Requires active consent grant
  router.get('/profile/public/:address', async (req, res) => {
    let patientAddress;
    try {
      patientAddress = normalizePatientWallet(req.params.address);
    } catch {
      return res.status(400).json({ error: 'Invalid patient wallet address.' });
    }

    const doctorAddress = req.profileWallet;

    // Self-lookup is always allowed
    if (patientAddress === doctorAddress) {
      try {
        const profile = store.get(patientAddress);
        return res.json({
          profile: {
            walletAddress: patientAddress,
            displayName: profile?.displayName || '',
            avatar: profile?.avatar || '',
          },
          hasProfile: Boolean(profile),
        });
      } catch {
        return res.status(503).json({ error: 'Profile storage unavailable.' });
      }
    }

    // Verify active consent grant
    try {
      if (expiryStore) {
        const grant = expiryStore.getActiveGrant(patientAddress, doctorAddress);
        if (!grant) {
          return res.status(403).json({ error: 'No active patient consent grant.' });
        }
      }

      const authorized = await hasAccess(patientAddress, doctorAddress);
      if (!authorized) {
        return res.status(403).json({ error: 'No active patient consent grant.' });
      }

      const profile = store.get(patientAddress);
      return res.json({
        profile: {
          walletAddress: patientAddress,
          displayName: profile?.displayName || '',
          avatar: profile?.avatar || '',
        },
        hasProfile: Boolean(profile),
      });
    } catch (err) {
      if (err.message && err.message.includes('No active')) {
        return res.status(403).json({ error: 'No active patient consent grant.' });
      }
      return res.status(503).json({ error: 'Could not verify patient consent on-chain. Retry when the network is available.' });
    }
  });

  // GET /profile/lookup/:address - Any authenticated user looks up patient identity (name+avatar only)
  // Used by doctors on the "Find Patient" screen BEFORE consent is active.
  // Respects showIdentityToDoctors privacy toggle: if false or no profile, returns empty name/avatar.
  router.get('/profile/lookup/:address', (req, res) => {
    let patientAddress;
    try {
      patientAddress = normalizePatientWallet(req.params.address);
    } catch {
      return res.status(400).json({ error: 'Invalid patient wallet address.' });
    }

    try {
      const profile = store.get(patientAddress);
      // Honour privacy toggle: default is true (show identity) for profiles that exist and don't set it false
      const showIdentity = profile ? (profile.showIdentityToDoctors !== false) : false;
      const isRestricted = profile ? (profile.showIdentityToDoctors === false) : false;
      return res.json({
        profile: {
          walletAddress: patientAddress,
          displayName: showIdentity ? (profile?.displayName || '') : '',
          avatar: showIdentity ? (profile?.avatar || '') : '',
        },
        privacyRestricted: isRestricted,
        hasProfile: Boolean(profile),
      });
    } catch {
      return res.status(503).json({ error: 'Profile storage unavailable.' });
    }
  });

  return router;
}

export default createPatientRouter();
