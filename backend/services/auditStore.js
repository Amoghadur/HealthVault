import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir } from './storagePaths.js';

export function getAuditFilePath() {
  return process.env.HEALTHVAULT_AUDIT_FILE || path.join(getDataDir(), 'audit.jsonl');
}
const actions = new Set(['RecordStored', 'RecordDeleted', 'RecordServed', 'RecordAccessDenied', 'RecordUploadDenied', 'AccessRequested', 'RequestAccepted', 'RequestRejected', 'EmergencyCreated', 'EmergencyServed']);

// Deliberately allowlist fields: never store tokens, encryption keys, or medical data.
export function createAuditStore(file = getAuditFilePath()) {
  let writeFailed = false;
  return {
    append({ action, actor, patient, doctor, recordId, outcome = 'completed' }) {
      if (!actions.has(action)) throw new Error('Unsupported audit action');
      const event = {
        id: randomUUID(), source: 'backend', action, timestamp: new Date().toISOString(),
        actor: actor?.toLowerCase() || null, patient: patient?.toLowerCase() || null,
        doctor: doctor?.toLowerCase() || null, recordId: recordId ? String(recordId) : null, outcome,
      };
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
        writeFailed = false;
        return event;
      } catch {
        writeFailed = true;
        throw new Error('Backend audit storage unavailable');
      }
    },
    read(address) {
      if (writeFailed) throw new Error('Some backend actions could not be recorded');
      if (!fs.existsSync(file)) return [];
      const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      const wallet = address.toLowerCase();
      return events.filter(e => [e.actor, e.patient, e.doctor].includes(wallet));
    },
  };
}

export const auditStore = createAuditStore(getAuditFilePath());
export function recordActivity(event) {
  try { auditStore.append(event); }
  catch { console.error('Backend audit storage unavailable; the audit endpoint will report incomplete coverage.'); }
}
