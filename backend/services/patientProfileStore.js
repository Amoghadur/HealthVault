import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { getDataDir } from './storagePaths.js';

export const ALLOWED_BLOOD_GROUPS = new Set(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

export const ALLOWED_DIABETES_STATUS = new Set([
  '',
  'Type 1 diabetes',
  'Type 2 diabetes',
  'Prediabetes',
  'No diabetes',
  'Unknown / Not provided',
  'Unknown',
]);

export const ALLOWED_ALLERGIES_STATUS = new Set([
  '',
  'has_allergies',
  'no_known_allergies',
  'unknown',
  'No known allergies',
  'Unknown / Not provided',
  'Unknown',
]);

export const PATIENT_FIELD_LIMITS = {
  displayName: 40,
  avatar: 300_000, // string length limit (raw base64 ~275 KB for 200 KB image)
  phone: 20,
  dateOfBirth: 10,
  bloodGroup: 5,
  about: 120,
  emergencyContactName: 60,
  emergencyContactPhone: 20,
  // boolean stored as literal true/false — not a string length
  showIdentityToDoctors: 1,
  // Known allergies and diabetes status
  allergies: 50,
  allergiesStatus: 30,
  diabetesStatus: 40,
};

export function normalizePatientWallet(address) {
  if (typeof address !== 'string' || !ethers.isAddress(address)) {
    throw new Error('Invalid wallet address.');
  }
  return address.toLowerCase();
}

function stripHtml(str) {
  return typeof str === 'string' ? str.replace(/<[^>]*>/g, '') : '';
}

export function validatePatientProfileFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid profile payload.');
  }

  // Reject unexpected or forbidden keys
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(PATIENT_FIELD_LIMITS, key)) {
      throw new Error(`Field '${key}' is not allowed in patient profile.`);
    }
  }

  // showIdentityToDoctors: optional boolean, defaults to true
  let showIdentityToDoctors = true;
  if (input.showIdentityToDoctors !== undefined && input.showIdentityToDoctors !== null) {
    showIdentityToDoctors = Boolean(input.showIdentityToDoctors);
  }

  // displayName: required, trimmed, 2-40 chars
  let rawName = input.displayName;
  if (typeof rawName !== 'string') {
    throw new Error('displayName must be a text value between 2 and 40 characters.');
  }
  const displayName = stripHtml(rawName).trim();
  if (displayName.length < 2 || displayName.length > PATIENT_FIELD_LIMITS.displayName) {
    throw new Error('displayName must be between 2 and 40 characters.');
  }
  if (/[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new Error('displayName contains invalid control characters.');
  }

  // avatar: optional data URL, png/jpeg/webp only, max 200 KB
  let avatar = '';
  if (input.avatar !== undefined && input.avatar !== null && input.avatar !== '') {
    if (typeof input.avatar !== 'string') {
      throw new Error('avatar must be a data URL string.');
    }
    const match = input.avatar.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error('avatar must be a valid PNG, JPEG, or WebP data URL.');
    }
    const base64Data = match[2];
    const padding = (base64Data.endsWith('==') ? 2 : base64Data.endsWith('=') ? 1 : 0);
    const decodedBytes = Math.floor((base64Data.length * 3) / 4) - padding;
    if (decodedBytes > 200 * 1024) {
      throw new Error('avatar exceeds the maximum size of 200 KB.');
    }
    avatar = input.avatar;
  }

  // phone: optional, max 20 chars
  let phone = '';
  if (input.phone !== undefined && input.phone !== null && input.phone !== '') {
    if (typeof input.phone !== 'string') {
      throw new Error('phone must be a string.');
    }
    const cleanPhone = stripHtml(input.phone).trim();
    if (cleanPhone.length > PATIENT_FIELD_LIMITS.phone) {
      throw new Error(`phone must be at most ${PATIENT_FIELD_LIMITS.phone} characters.`);
    }
    if (!/^[0-9+\s()-]*$/.test(cleanPhone)) {
      throw new Error('phone contains invalid characters.');
    }
    phone = cleanPhone;
  }

  // dateOfBirth: optional, YYYY-MM-DD
  let dateOfBirth = '';
  if (input.dateOfBirth !== undefined && input.dateOfBirth !== null && input.dateOfBirth !== '') {
    if (typeof input.dateOfBirth !== 'string') {
      throw new Error('dateOfBirth must be a string.');
    }
    const cleanDob = input.dateOfBirth.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDob)) {
      throw new Error('dateOfBirth must be in YYYY-MM-DD format.');
    }
    const parsed = Date.parse(cleanDob);
    if (!Number.isFinite(parsed) || parsed > Date.now()) {
      throw new Error('dateOfBirth must be a valid past date.');
    }
    dateOfBirth = cleanDob;
  }

  // bloodGroup: optional, enum
  let bloodGroup = '';
  if (input.bloodGroup !== undefined && input.bloodGroup !== null && input.bloodGroup !== '') {
    if (typeof input.bloodGroup !== 'string' || !ALLOWED_BLOOD_GROUPS.has(input.bloodGroup.trim())) {
      throw new Error('bloodGroup must be one of A+, A-, B+, B-, AB+, AB-, O+, O-.');
    }
    bloodGroup = input.bloodGroup.trim();
  }

  // about: optional, max 120 chars
  let about = '';
  if (input.about !== undefined && input.about !== null && input.about !== '') {
    if (typeof input.about !== 'string') {
      throw new Error('about must be a string.');
    }
    const cleanAbout = stripHtml(input.about).trim();
    if (cleanAbout.length > PATIENT_FIELD_LIMITS.about) {
      throw new Error(`about must be at most ${PATIENT_FIELD_LIMITS.about} characters.`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleanAbout)) {
      throw new Error('about contains invalid control characters.');
    }
    about = cleanAbout;
  }

  // emergencyContactName: optional, max 60 chars
  let emergencyContactName = '';
  if (input.emergencyContactName !== undefined && input.emergencyContactName !== null && input.emergencyContactName !== '') {
    if (typeof input.emergencyContactName !== 'string') {
      throw new Error('emergencyContactName must be a string.');
    }
    const cleanEcn = stripHtml(input.emergencyContactName).trim();
    if (cleanEcn.length > PATIENT_FIELD_LIMITS.emergencyContactName) {
      throw new Error(`emergencyContactName must be at most ${PATIENT_FIELD_LIMITS.emergencyContactName} characters.`);
    }
    if (/[\u0000-\u001f\u007f]/.test(cleanEcn)) {
      throw new Error('emergencyContactName contains invalid control characters.');
    }
    emergencyContactName = cleanEcn;
  }

  // emergencyContactPhone: optional, max 20 chars
  let emergencyContactPhone = '';
  if (input.emergencyContactPhone !== undefined && input.emergencyContactPhone !== null && input.emergencyContactPhone !== '') {
    if (typeof input.emergencyContactPhone !== 'string') {
      throw new Error('emergencyContactPhone must be a string.');
    }
    const cleanEcp = stripHtml(input.emergencyContactPhone).trim();
    if (cleanEcp.length > PATIENT_FIELD_LIMITS.emergencyContactPhone) {
      throw new Error(`emergencyContactPhone must be at most ${PATIENT_FIELD_LIMITS.emergencyContactPhone} characters.`);
    }
    if (!/^[0-9+\s()-]*$/.test(cleanEcp)) {
      throw new Error('emergencyContactPhone contains invalid characters.');
    }
    emergencyContactPhone = cleanEcp;
  }

  // diabetesStatus: optional enum, defaults to 'Unknown / Not provided'
  let diabetesStatus = 'Unknown / Not provided';
  if (input.diabetesStatus !== undefined && input.diabetesStatus !== null && input.diabetesStatus !== '') {
    if (typeof input.diabetesStatus !== 'string') {
      throw new Error('diabetesStatus must be a string.');
    }
    const cleanDiabetes = input.diabetesStatus.trim();
    if (!ALLOWED_DIABETES_STATUS.has(cleanDiabetes)) {
      throw new Error('diabetesStatus must be one of: Type 1 diabetes, Type 2 diabetes, Prediabetes, No diabetes, Unknown / Not provided.');
    }
    diabetesStatus = (cleanDiabetes === 'Unknown' || cleanDiabetes === 'Unknown / Not provided')
      ? 'Unknown / Not provided'
      : cleanDiabetes;
  }

  // allergiesStatus: optional enum ('has_allergies', 'no_known_allergies', 'unknown')
  let allergiesStatus = 'unknown';
  if (input.allergiesStatus !== undefined && input.allergiesStatus !== null && input.allergiesStatus !== '') {
    if (typeof input.allergiesStatus !== 'string') {
      throw new Error('allergiesStatus must be a string.');
    }
    const cleanAllergyStatus = input.allergiesStatus.trim();
    if (!ALLOWED_ALLERGIES_STATUS.has(cleanAllergyStatus)) {
      throw new Error('allergiesStatus must be one of: has_allergies, no_known_allergies, unknown.');
    }
    if (cleanAllergyStatus === 'no_known_allergies' || cleanAllergyStatus.toLowerCase() === 'no known allergies') {
      allergiesStatus = 'no_known_allergies';
    } else if (cleanAllergyStatus === 'unknown' || cleanAllergyStatus.toLowerCase().startsWith('unknown')) {
      allergiesStatus = 'unknown';
    } else {
      allergiesStatus = 'has_allergies';
    }
  }

  // allergies: array of strings or comma-separated string
  let allergies = [];
  if (input.allergies !== undefined && input.allergies !== null && input.allergies !== '') {
    let rawList = [];
    if (Array.isArray(input.allergies)) {
      rawList = input.allergies;
    } else if (typeof input.allergies === 'string') {
      rawList = input.allergies.split(',');
    } else {
      throw new Error('allergies must be an array of strings.');
    }

    const seen = new Set();
    for (const item of rawList) {
      if (typeof item !== 'string') {
        throw new Error('Each allergy entry must be a text value.');
      }
      const cleanItem = stripHtml(item).trim();
      if (!cleanItem) continue;
      if (cleanItem.length > PATIENT_FIELD_LIMITS.allergies) {
        throw new Error(`Each allergy must be at most ${PATIENT_FIELD_LIMITS.allergies} characters.`);
      }
      if (/[\u0000-\u001f\u007f]/.test(cleanItem)) {
        throw new Error('Allergy entry contains invalid control characters.');
      }
      const lower = cleanItem.toLowerCase();
      if (lower === 'no known allergies' || lower === 'nkda') {
        allergiesStatus = 'no_known_allergies';
        continue;
      }
      if (lower === 'unknown' || lower === 'not provided' || lower === 'none') {
        continue;
      }
      if (!seen.has(lower)) {
        seen.add(lower);
        allergies.push(cleanItem);
      }
    }

    if (allergies.length > 30) {
      throw new Error('Allergies list cannot exceed 30 items.');
    }

    if (allergies.length > 0 && input.allergiesStatus === undefined) {
      allergiesStatus = 'has_allergies';
    }
  }

  // If status is explicitly no_known_allergies or unknown, allergies list is cleared
  if (allergiesStatus === 'no_known_allergies' || allergiesStatus === 'unknown') {
    allergies = [];
  }

  return {
    displayName,
    avatar,
    phone,
    dateOfBirth,
    bloodGroup,
    about,
    emergencyContactName,
    emergencyContactPhone,
    showIdentityToDoctors,
    allergies,
    allergiesStatus,
    diabetesStatus,
  };
}

export function createPatientProfileStore(file = path.join(getDataDir(), 'patient_profiles.json')) {
  function read() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('Invalid profile storage');
    const wallets = new Set();
    const SYSTEM_KEYS = new Set(['walletAddress', 'createdAt', 'updatedAt']);
    return items.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid profile storage');
      if (Object.keys(item).some(key => !Object.hasOwn(PATIENT_FIELD_LIMITS, key) && !SYSTEM_KEYS.has(key))) {
        throw new Error('Invalid keys in profile storage');
      }
      const walletAddress = normalizePatientWallet(item.walletAddress);
      if (wallets.has(walletAddress)) throw new Error('Duplicate wallet in profile storage');
      wallets.add(walletAddress);
      if (!['createdAt', 'updatedAt'].every(key => typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key])))) {
        throw new Error('Invalid profile storage timestamps');
      }
      const fields = validatePatientProfileFields(
        Object.fromEntries(Object.keys(PATIENT_FIELD_LIMITS).map(key => [key, item[key]]))
      );
      return {
        walletAddress,
        ...fields,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  }

  return {
    filePath: file,
    get(address) {
      const wallet = normalizePatientWallet(address);
      return read().find(item => item.walletAddress === wallet) || null;
    },
    save(address, input) {
      const walletAddress = normalizePatientWallet(address);
      const fields = validatePatientProfileFields(input);
      const items = read();
      const index = items.findIndex(item => item.walletAddress === walletAddress);
      const now = new Date().toISOString();
      const profile = {
        walletAddress,
        ...fields,
        createdAt: index < 0 ? now : items[index].createdAt,
        updatedAt: now,
      };
      if (index < 0) items.push(profile);
      else items[index] = profile;

      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
      } finally {
        if (fs.existsSync(temporary)) {
          try { fs.unlinkSync(temporary); } catch { /* ignore */ }
        }
      }
      return profile;
    },
  };
}

export const defaultPatientProfileStore = createPatientProfileStore();
