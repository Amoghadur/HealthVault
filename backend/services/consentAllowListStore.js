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

export function createConsentAllowListStore(file = path.join(getDataDir(), 'consent_allow_lists.json')) {
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
      throw new Error('Invalid consent allow-list storage');
    }
    if (!Array.isArray(items)) throw new Error('Invalid consent allow-list storage');
    return items.map(item => {
      if (!item || typeof item !== 'object') throw new Error('Invalid consent allow-list storage');
      const patientAddress = normalizeWallet(item.patientAddress);
      const doctorAddress = normalizeWallet(item.doctorAddress);
      const recordIds = Array.isArray(item.recordIds)
        ? item.recordIds.filter(id => typeof id === 'string' && id.trim()).map(id => String(id).trim())
        : [];
      return {
        patientAddress,
        doctorAddress,
        recordIds: [...new Set(recordIds)],
        updatedAt: item.updatedAt || new Date().toISOString()
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
    getAllowList(patient, doctor) {
      const p = normalizeWallet(patient);
      const d = normalizeWallet(doctor);
      const entry = read().find(item => item.patientAddress === p && item.doctorAddress === d);
      return entry ? entry.recordIds : null;
    },
    setAllowList({ patientAddress, doctorAddress, recordIds, validPatientRecordIds }) {
      const p = normalizeWallet(patientAddress);
      const d = normalizeWallet(doctorAddress);
      if (p === d) throw new Error('Cannot share records with yourself.');

      if (!Array.isArray(recordIds)) {
        throw new Error('recordIds must be an array of record IDs.');
      }

      let validIds = recordIds
        .filter(id => id !== null && id !== undefined && String(id).trim().length > 0)
        .map(id => String(id).trim());

      // If validPatientRecordIds is provided, strictly filter out any ID not belonging to this patient
      if (validPatientRecordIds) {
        const allowedSet = validPatientRecordIds instanceof Set
          ? validPatientRecordIds
          : new Set(validPatientRecordIds.map(String));
        validIds = validIds.filter(id => allowedSet.has(id));
      }

      const deduplicated = [...new Set(validIds)];
      const items = read();
      const index = items.findIndex(item => item.patientAddress === p && item.doctorAddress === d);
      const entry = {
        patientAddress: p,
        doctorAddress: d,
        recordIds: deduplicated,
        updatedAt: new Date().toISOString()
      };

      if (index < 0) {
        items.push(entry);
      } else {
        items[index] = entry;
      }

      write(items);
      return entry;
    },
    removeAllowList(patient, doctor) {
      const p = normalizeWallet(patient);
      const d = normalizeWallet(doctor);
      const items = read();
      const filtered = items.filter(item => !(item.patientAddress === p && item.doctorAddress === d));
      if (filtered.length !== items.length) {
        write(filtered);
        return true;
      }
      return false;
    },
    listByPatient(patient) {
      const p = normalizeWallet(patient);
      return read().filter(item => item.patientAddress === p);
    }
  };
}

export const defaultConsentAllowListStore = createConsentAllowListStore();
