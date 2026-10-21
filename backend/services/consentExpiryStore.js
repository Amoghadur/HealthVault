import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { getDataDir } from './storagePaths.js';

export const ALLOWED_DURATIONS = [5, 15, 30, 60];
const ALLOWED_SET = new Set(ALLOWED_DURATIONS);

export function normalizeWallet(address) {
  if (typeof address !== 'string' || !ethers.isAddress(address)) {
    throw new Error('Invalid wallet address.');
  }
  return address.toLowerCase();
}

export function validateDuration(minutes) {
  const num = Number(minutes);
  if (!Number.isInteger(num) || !ALLOWED_SET.has(num)) {
    throw new Error('Duration must be 5, 15, 30, or 60 minutes.');
  }
  return num;
}

export function createConsentExpiryStore(file = path.join(getDataDir(), 'consent_expiries.json')) {
  function read() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Invalid consent expiry storage');
    return items.map(item => {
      if (!item || typeof item !== 'object') throw new Error('Invalid consent expiry storage');
      const patientAddress = normalizeWallet(item.patientAddress);
      const doctorAddress = normalizeWallet(item.doctorAddress);
      const durationMinutes = validateDuration(item.durationMinutes);
      if (!['grantedAt', 'expiresAt'].every(key => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])))) {
        throw new Error('Invalid consent expiry storage');
      }
      if (item.revokedAt !== null && item.revokedAt !== undefined) {
        if (typeof item.revokedAt !== 'string' || !Number.isFinite(Date.parse(item.revokedAt))) {
          throw new Error('Invalid consent expiry storage');
        }
      }
      return {
        patientAddress,
        doctorAddress,
        durationMinutes,
        grantedAt: item.grantedAt,
        expiresAt: item.expiresAt,
        revokedAt: item.revokedAt || null,
      };
    });
  }

  function write(items) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  return {
    filePath: file,
    get(patient, doctor) {
      const p = normalizeWallet(patient);
      const d = normalizeWallet(doctor);
      return read().find(item => item.patientAddress === p && item.doctorAddress === d) || null;
    },
    getActiveGrant(patient, doctor, now = Date.now()) {
      const grant = this.get(patient, doctor);
      if (!grant) return null;
      if (grant.revokedAt) return null;
      if (Date.parse(grant.expiresAt) <= now) return null;
      return grant;
    },
    saveGrant({ patientAddress, doctorAddress, durationMinutes, grantedAt = new Date().toISOString() }) {
      const patient = normalizeWallet(patientAddress);
      const doctor = normalizeWallet(doctorAddress);
      if (patient === doctor) throw new Error('Cannot grant temporary access to yourself.');
      const duration = validateDuration(durationMinutes);
      const grantedTime = Date.parse(grantedAt);
      if (!Number.isFinite(grantedTime)) throw new Error('Invalid grantedAt timestamp.');
      const expiresAt = new Date(grantedTime + duration * 60 * 1000).toISOString();

      const items = read();
      const index = items.findIndex(item => item.patientAddress === patient && item.doctorAddress === doctor);
      const grant = {
        patientAddress: patient,
        doctorAddress: doctor,
        durationMinutes: duration,
        grantedAt,
        expiresAt,
        revokedAt: null,
      };
      if (index < 0) items.push(grant);
      else items[index] = grant;
      write(items);
      return grant;
    },
    revoke(patient, doctor) {
      const p = normalizeWallet(patient);
      const d = normalizeWallet(doctor);
      const items = read();
      const index = items.findIndex(item => item.patientAddress === p && item.doctorAddress === d);
      if (index < 0) return false;
      if (items[index].revokedAt) return false;
      items[index].revokedAt = new Date().toISOString();
      write(items);
      return true;
    },
    listByPatient(patient) {
      const p = normalizeWallet(patient);
      return read().filter(item => item.patientAddress === p);
    },
    listByDoctor(doctor) {
      const d = normalizeWallet(doctor);
      return read().filter(item => item.doctorAddress === d);
    },
  };
}

export const defaultExpiryStore = createConsentExpiryStore();
