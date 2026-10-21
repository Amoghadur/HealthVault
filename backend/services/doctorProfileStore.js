import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { getDataDir } from './storagePaths.js';

const limits = { displayName: 160, specialty: 120, affiliation: 200, department: 120, registrationNumber: 100 };
const required = new Set(['displayName', 'specialty', 'affiliation']);
export function normalizeProfileWallet(address) {
  if (typeof address !== 'string' || !ethers.isAddress(address)) throw new Error('Invalid wallet address.');
  return address.toLowerCase();
}

export function validateProfileFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(limits, key))) {
    throw new Error('Only displayName, specialty, affiliation, department and registrationNumber are editable.');
  }
  const fields = {};
  for (const [key, max] of Object.entries(limits)) {
    const value = input[key] === undefined && !required.has(key) ? '' : input[key];
    if (typeof value !== 'string' || value.length > max || (required.has(key) && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`${key} must be ${required.has(key) ? 'a non-empty' : 'a'} text value of at most ${max} characters.`);
    }
    fields[key] = value.trim();
  }
  return fields;
}

export function createDoctorProfileStore(file = path.join(getDataDir(), 'doctor_profiles.json')) {
  function read() {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Invalid profile storage');
    const wallets = new Set();
    return items.map(item => {
      if (!item || Object.keys(item).some(key => !Object.hasOwn(limits, key) && !['walletAddress', 'verificationStatus', 'createdAt', 'updatedAt'].includes(key))) throw new Error('Invalid profile storage');
      const walletAddress = normalizeProfileWallet(item.walletAddress);
      if (wallets.has(walletAddress) || item.verificationStatus !== 'unverified' || !['createdAt', 'updatedAt'].every(key => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])))) throw new Error('Invalid profile storage');
      wallets.add(walletAddress);
      const fields = validateProfileFields(Object.fromEntries(Object.keys(limits).map(key => [key, item[key]])));
      return { walletAddress, ...fields, verificationStatus: 'unverified', createdAt: item.createdAt, updatedAt: item.updatedAt };
    });
  }
  return {
    get(address) { return read().find(item => item.walletAddress === normalizeProfileWallet(address)) || null; },
    save(address, input) {
      const walletAddress = normalizeProfileWallet(address);
      const fields = validateProfileFields(input);
      // Synchronous read/modify/rename serializes updates in the existing single process.
      const items = read();
      const index = items.findIndex(item => item.walletAddress === walletAddress);
      const now = new Date().toISOString();
      const profile = { walletAddress, ...fields, verificationStatus: 'unverified', createdAt: index < 0 ? now : items[index].createdAt, updatedAt: now };
      if (index < 0) items.push(profile); else items[index] = profile;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      return profile;
    },
  };
}
