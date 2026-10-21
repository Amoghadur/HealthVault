import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './storagePaths.js';

export function createAppointmentStore(file = path.join(getDataDir(), 'appointments.json')) {
  return {
    read() {
      if (!fs.existsSync(file)) return [];
      const items = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(items)) throw new Error('Invalid appointment storage');
      return items;
    },
    write(items) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, file);
    },
  };
}
