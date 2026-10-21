import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Validates the RECORD_KEY_ENCRYPTION_SECRET master secret.
 * Must be a 32-byte (64 hexadecimal character) string.
 * Refuses invalid keys without leaking secret contents.
 */
export function validateMasterSecret(secret) {
  if (!secret || typeof secret !== "string") {
    throw new Error(
      "RECORD_KEY_ENCRYPTION_SECRET is required. Please set a 32-byte hex secret (64 hex characters)."
    );
  }
  const trimmed = secret.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      "RECORD_KEY_ENCRYPTION_SECRET must be a 64-character hexadecimal string (32 bytes)."
    );
  }
  return Buffer.from(trimmed, "hex");
}

/**
 * Wraps a per-record AES key using AES-256-GCM and the master key.
 * Returns { ciphertext, iv, tag } with 12-byte IV and 16-byte auth tag (all hex).
 */
export function wrapKey(plainKeyHexOrBuffer, masterKeyBuffer) {
  if (!masterKeyBuffer || !Buffer.isBuffer(masterKeyBuffer) || masterKeyBuffer.length !== 32) {
    throw new Error("A valid 32-byte master key buffer is required to wrap keys.");
  }

  const keyBuf = typeof plainKeyHexOrBuffer === "string"
    ? Buffer.from(plainKeyHexOrBuffer, "hex")
    : plainKeyHexOrBuffer;

  if (!Buffer.isBuffer(keyBuf) || keyBuf.length !== 32) {
    throw new Error("Invalid record key length: per-record key must be 32 bytes (256 bits).");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKeyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(keyBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex")
  };
}

/**
 * Unwraps a wrapped record AES key using AES-256-GCM and the master key.
 * Throws authentication failure if key, IV, tag, or ciphertext was tampered or wrong.
 * Never prints or leaks secret keys in error messages.
 */
export function unwrapKey(wrappedKeyObj, masterKeyBuffer) {
  if (!masterKeyBuffer || !Buffer.isBuffer(masterKeyBuffer) || masterKeyBuffer.length !== 32) {
    throw new Error("A valid 32-byte master key buffer is required to unwrap keys.");
  }

  if (
    !wrappedKeyObj ||
    typeof wrappedKeyObj !== "object" ||
    typeof wrappedKeyObj.ciphertext !== "string" ||
    typeof wrappedKeyObj.iv !== "string" ||
    typeof wrappedKeyObj.tag !== "string"
  ) {
    throw new Error("Invalid wrapped key format: expected object with ciphertext, iv, and tag hex strings.");
  }

  if (
    !/^[0-9a-fA-F]{24}$/.test(wrappedKeyObj.iv) ||
    !/^[0-9a-fA-F]{32}$/.test(wrappedKeyObj.tag) ||
    !/^[0-9a-fA-F]{64}$/.test(wrappedKeyObj.ciphertext)
  ) {
    throw new Error("Malformed wrapped key components: invalid hex encoding or component length.");
  }

  try {
    const iv = Buffer.from(wrappedKeyObj.iv, "hex");
    const tag = Buffer.from(wrappedKeyObj.tag, "hex");
    const ciphertext = Buffer.from(wrappedKeyObj.ciphertext, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKeyBuffer, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("hex");
  } catch {
    throw new Error("Failed to unwrap record encryption key: authentication or decryption failed.");
  }
}

/**
 * Resolves the raw encryption key for a record:
 * - If record has wrappedKey, unwraps it with masterKeyBuffer.
 * - If record has legacy encryptionKey, returns it directly (unmigrated support).
 * - Otherwise throws an error.
 */
export function resolveRecordKey(record, masterKeyBuffer) {
  if (!record || typeof record !== "object") {
    throw new Error("Invalid record object.");
  }
  if (record.wrappedKey) {
    if (!masterKeyBuffer) {
      throw new Error("Master encryption key is required to unwrap record key.");
    }
    return unwrapKey(record.wrappedKey, masterKeyBuffer);
  }
  if (record.encryptionKey) {
    return record.encryptionKey;
  }
  throw new Error("Record contains neither wrappedKey nor encryptionKey.");
}

/**
 * Idempotent one-time migration:
 * Wraps existing plain keys in records_metadata.json using AES-256-GCM.
 * Creates a timestamped backup before modifying the file and never deletes the backup.
 * Subsequent runs detect already-wrapped records and do nothing (no duplicate backups).
 */
export function migrateRecordsMetadata({ uploadsDir = "uploads", masterKeyBuffer, now = Date.now } = {}) {
  const recordsFilePath = path.join(uploadsDir, "records_metadata.json");
  if (!fs.existsSync(recordsFilePath)) {
    return { migrated: false, count: 0, reason: "file-not-found" };
  }

  let raw;
  try {
    raw = fs.readFileSync(recordsFilePath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read records metadata: ${err.message}`);
  }

  let records;
  try {
    records = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse records metadata: ${err.message}`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { migrated: false, count: 0, reason: "empty" };
  }

  const unmigrated = records.filter(r => r && r.encryptionKey);
  if (unmigrated.length === 0) {
    // Already migrated; do not touch file or create redundant backups
    return { migrated: false, count: 0, reason: "already-migrated" };
  }

  if (!masterKeyBuffer || !Buffer.isBuffer(masterKeyBuffer) || masterKeyBuffer.length !== 32) {
    throw new Error("A valid 32-byte master key buffer is required to perform records migration.");
  }

  // Copy original metadata file to a timestamped backup next to it
  const timestamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(uploadsDir, `records_metadata.backup-${timestamp}.json`);
  fs.copyFileSync(recordsFilePath, backupPath);

  // Wrap keys and remove plaintext keys
  for (const record of records) {
    if (record.encryptionKey) {
      record.wrappedKey = wrapKey(record.encryptionKey, masterKeyBuffer);
      delete record.encryptionKey;
    }
  }

  // Atomically replace records_metadata.json
  const tmpPath = path.join(uploadsDir, `records_metadata.json.tmp-${Date.now()}`);
  fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(tmpPath, recordsFilePath);

  return { migrated: true, count: unmigrated.length, backupPath };
}
