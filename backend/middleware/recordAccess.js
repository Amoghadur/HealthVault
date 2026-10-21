import fs from 'node:fs';
import { ethers } from 'ethers';
import { readCurrentAccess } from '../services/blockchain.js';
import { recordActivity } from '../services/auditStore.js';
import { defaultExpiryStore } from '../services/consentExpiryStore.js';

export function createUploadAuthorization({ hasAccess = readCurrentAccess, audit = recordActivity, expiryStore = (hasAccess === readCurrentAccess ? defaultExpiryStore : null) } = {}) {
  return async (req, res, next) => {
    const patient = req.body.patientAddress;
    const actor = req.user.address.toLowerCase();
    const reject = (status, error) => {
      // Multer has already created this request's temporary plaintext file.
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(status).json({ error });
    };
    if (typeof patient !== 'string' || !ethers.isAddress(patient)) return reject(400, 'A valid patient wallet address is required.');
    if (patient.toLowerCase() === actor) return next();
    if (expiryStore) {
      const grant = expiryStore.getActiveGrant(patient, actor);
      if (!grant) {
        audit({ action: 'RecordUploadDenied', actor, patient: patient.toLowerCase(), outcome: 'expired-or-missing' });
        return reject(403, 'Patient access consent has expired or has not been granted. Access is required before uploading.');
      }
    }
    try {
      if (await hasAccess(patient, actor)) return next();
      if (expiryStore) expiryStore.revoke(patient, actor);
      audit({ action: 'RecordUploadDenied', actor, patient: patient.toLowerCase(), outcome: 'denied' });
      return reject(403, 'Patient consent is required before uploading. Access may have been revoked.');
    } catch {
      return reject(503, 'Could not verify patient consent on Sepolia. No upload was stored; retry when the network is available.');
    }
  };
}

// Public compatibility URLs may serve encrypted file blobs, never the metadata/key store.
export function encryptedFilesOnly(req, res, next) {
  let pathname;
  try { pathname = decodeURIComponent(req.path); }
  catch { return res.status(400).json({ error: 'Invalid file path' }); }
  if (!/^\/enc_[^/\\]+$/.test(pathname)) return res.status(404).json({ error: 'File not found' });
  return next();
}
