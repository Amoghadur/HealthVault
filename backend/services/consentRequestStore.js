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

export function createConsentRequestStore(file = path.join(getDataDir(), 'consent_requests.json')) {
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
      throw new Error('Invalid consent request storage');
    }
    if (!Array.isArray(items)) throw new Error('Invalid consent request storage');
    return items.map(item => {
      if (!item || typeof item !== 'object' || !item.id) {
        throw new Error('Invalid consent request storage');
      }
      return {
        id: String(item.id),
        patientAddress: normalizeWallet(item.patientAddress),
        doctorAddress: normalizeWallet(item.doctorAddress),
        reason: typeof item.reason === 'string' ? item.reason : 'Medical consultation',
        status: item.status || 'pending',
        requestedAt: item.requestedAt || item.createdAt || new Date().toISOString(),
        createdAt: item.createdAt || item.requestedAt || new Date().toISOString(),
        expiresAt: item.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        respondedAt: item.respondedAt || null
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
    getPendingForPatient(patientAddress, now = Date.now()) {
      const patient = normalizeWallet(patientAddress);
      const items = read().filter(r => r.patientAddress === patient && r.status === 'pending' && Date.parse(r.expiresAt) > now);
      const seen = new Set();
      const deduped = [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          deduped.push(item);
        }
      }
      return deduped;
    },
    getPendingForDoctor(doctorAddress, now = Date.now()) {
      const doctor = normalizeWallet(doctorAddress);
      const items = read().filter(r => r.doctorAddress === doctor && r.status === 'pending' && Date.parse(r.expiresAt) > now);
      const seen = new Set();
      const deduped = [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          deduped.push(item);
        }
      }
      return deduped;
    },
    getRequestsForDoctor(doctorAddress, now = Date.now()) {
      const doctor = normalizeWallet(doctorAddress);
      const items = read().filter(r => r.doctorAddress === doctor);
      const seen = new Set();
      const deduped = [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          deduped.push(item);
        }
      }
      return deduped;
    },
    findPending(patientAddress, doctorAddress, now = Date.now()) {
      const patient = normalizeWallet(patientAddress);
      const doctor = normalizeWallet(doctorAddress);
      return read().find(r => r.patientAddress === patient && r.doctorAddress === doctor && r.status === 'pending' && Date.parse(r.expiresAt) > now) || null;
    },
    findById(id) {
      if (!id) return null;
      return read().find(r => r.id === String(id)) || null;
    },
    createRequest({ patientAddress, doctorAddress, reason = 'Medical consultation', ttlMs = 24 * 60 * 60 * 1000, now = Date.now() }) {
      const patient = normalizeWallet(patientAddress);
      const doctor = normalizeWallet(doctorAddress);
      const existing = this.findPending(patient, doctor, now);
      if (existing) {
        return { created: false, request: existing };
      }
      const requestedAt = new Date(now).toISOString();
      const expiresAt = new Date(now + ttlMs).toISOString();
      const items = read();
      let reqId = now.toString();
      if (items.some(r => r.id === reqId)) {
        reqId = `${now}-${randomUUID().slice(0, 8)}`;
      }
      const request = {
        id: reqId,
        patientAddress: patient,
        doctorAddress: doctor,
        reason: reason || 'Medical consultation',
        requestedAt,
        createdAt: requestedAt,
        expiresAt,
        status: 'pending',
        respondedAt: null
      };
      items.push(request);
      write(items);
      return { created: true, request };
    },
    respond({ requestId, patientAddress, action, now = Date.now() }) {
      const patient = normalizeWallet(patientAddress);
      const items = read();
      const request = items.find(r => r.id === String(requestId) && r.patientAddress === patient);
      if (!request) throw new Error('Request not found');
      if (Date.parse(request.expiresAt) <= now) {
        throw new Error('Request has expired');
      }
      request.status = action === 'accept' ? 'accepted' : 'rejected';
      request.respondedAt = new Date(now).toISOString();
      write(items);
      return request;
    },
    getAll() {
      return read();
    }
  };
}

export const defaultConsentRequestStore = createConsentRequestStore();
