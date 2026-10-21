import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { getDataDir } from './storagePaths.js';

export function normalizeWallet(address) {
  if (typeof address !== 'string' || !ethers.isAddress(address)) {
    throw new Error('Invalid wallet address.');
  }
  return address.toLowerCase();
}

export function createEmergencyTokenStore(file = path.join(getDataDir(), 'emergency_tokens.json')) {
  function read() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    let items;
    try {
      items = JSON.parse(raw);
    } catch {
      throw new Error('Invalid emergency token storage');
    }
    if (!Array.isArray(items)) throw new Error('Invalid emergency token storage');
    return items.map(item => {
      if (!item || typeof item !== 'object' || typeof item.token !== 'string' || !item.token) {
        throw new Error('Invalid emergency token storage');
      }
      return {
        token: item.token,
        patientAddress: normalizeWallet(item.patientAddress),
        expiry: Number(item.expiry),
        expiresAt: item.expiresAt || new Date(Number(item.expiry)).toISOString(),
        createdAt: item.createdAt || new Date().toISOString(),
        revoked: Boolean(item.revoked),
        revokedAt: item.revokedAt || null,
        data: item.data && typeof item.data === 'object' ? item.data : {}
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
    get(token) {
      if (!token || typeof token !== 'string') return null;
      return read().find(t => t.token === token) || null;
    },
    getActive(token, now = Date.now()) {
      const record = this.get(token);
      if (!record) return null;
      if (record.revoked) return null;
      if (Number(record.expiry) <= now) return null;
      return record;
    },
    getActiveForPatient(patientAddress, now = Date.now()) {
      if (!patientAddress) return null;
      try {
        const patient = normalizeWallet(patientAddress);
        const activeTokens = read()
          .filter(t => t.patientAddress === patient && !t.revoked && Number(t.expiry) > now)
          .sort((a, b) => Number(b.expiry) - Number(a.expiry));
        return activeTokens[0] || null;
      } catch {
        return null;
      }
    },
    saveToken({ token, patientAddress, expiry, data = {} }) {
      if (!token || typeof token !== 'string') throw new Error('Token string is required.');
      const patient = normalizeWallet(patientAddress);
      const expNum = Number(expiry);
      if (!Number.isFinite(expNum) || expNum <= Date.now()) {
        throw new Error('Expiry must be a future timestamp.');
      }
      const record = {
        token,
        patientAddress: patient,
        expiry: expNum,
        expiresAt: new Date(expNum).toISOString(),
        createdAt: new Date().toISOString(),
        revoked: false,
        revokedAt: null,
        data: data && typeof data === 'object' ? data : {}
      };
      const items = read();
      const idx = items.findIndex(t => t.token === token);
      if (idx >= 0) items[idx] = record;
      else items.push(record);
      write(items);
      return record;
    },
    revokeToken(token, patientAddress) {
      if (!token || typeof token !== 'string') return false;
      const patient = patientAddress ? normalizeWallet(patientAddress) : null;
      const items = read();
      const target = items.find(t => t.token === token && (!patient || t.patientAddress === patient));
      if (!target || target.revoked) return false;
      target.revoked = true;
      target.revokedAt = new Date().toISOString();
      write(items);
      return true;
    },
    revokePatientTokens(patientAddress) {
      const patient = normalizeWallet(patientAddress);
      const items = read();
      let count = 0;
      const nowIso = new Date().toISOString();
      for (const item of items) {
        if (item.patientAddress === patient && !item.revoked) {
          item.revoked = true;
          item.revokedAt = nowIso;
          count++;
        }
      }
      if (count > 0) {
        write(items);
      }
      return count;
    },
    delete(token) {
      if (!token || typeof token !== 'string') return false;
      const items = read();
      const filtered = items.filter(t => t.token !== token);
      if (filtered.length !== items.length) {
        write(filtered);
        return true;
      }
      return false;
    },
    cleanup(now = Date.now()) {
      const items = read();
      const active = items.filter(t => Number(t.expiry) > now && !t.revoked);
      if (active.length !== items.length) {
        write(active);
      }
      return active;
    },
    getAll() {
      return read();
    }
  };
}

export const defaultEmergencyTokenStore = createEmergencyTokenStore();
