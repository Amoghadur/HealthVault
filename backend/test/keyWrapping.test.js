import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import express from "express";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import {
  validateMasterSecret,
  wrapKey,
  unwrapKey,
  resolveRecordKey,
  migrateRecordsMetadata
} from "../services/keyManagement.js";
import { createRecordRouter } from "../routes/records.js";

const TEST_JWT_SECRET = "key-wrapping-test-jwt-secret-at-least-32-chars";
process.env.JWT_SECRET = TEST_JWT_SECRET;

// Helper: build a minimal valid PDF buffer
function createSamplePdf(text = "HealthVault Medical Report") {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000183 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n250\n%%EOF\n`
  );
}

// ── 1. Master secret validation tests ──
test("validateMasterSecret: enforces 32-byte (64 hex characters) secret and rejects invalid values", () => {
  // Missing / non-string
  assert.throws(() => validateMasterSecret(null), /RECORD_KEY_ENCRYPTION_SECRET is required/);
  assert.throws(() => validateMasterSecret(undefined), /RECORD_KEY_ENCRYPTION_SECRET is required/);
  assert.throws(() => validateMasterSecret(""), /RECORD_KEY_ENCRYPTION_SECRET is required/);
  assert.throws(() => validateMasterSecret(12345), /RECORD_KEY_ENCRYPTION_SECRET is required/);

  // Wrong length
  assert.throws(() => validateMasterSecret("a".repeat(62)), /64-character hexadecimal string/);
  assert.throws(() => validateMasterSecret("a".repeat(66)), /64-character hexadecimal string/);

  // Non-hex characters
  assert.throws(() => validateMasterSecret("z".repeat(64)), /64-character hexadecimal string/);
  assert.throws(() => validateMasterSecret("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdeg"), /64-character hexadecimal string/);

  // Valid 64-hex string
  const validHex = crypto.randomBytes(32).toString("hex");
  const masterKeyBuf = validateMasterSecret(validHex);
  assert.ok(Buffer.isBuffer(masterKeyBuf));
  assert.equal(masterKeyBuf.length, 32);
  assert.equal(masterKeyBuf.toString("hex"), validHex.toLowerCase());
});

// ── 2. Key wrapping and unwrapping roundtrip tests ──
test("wrapKey and unwrapKey: roundtrip restores original key and uses fresh random IVs", () => {
  const masterKey = crypto.randomBytes(32);
  const recordKey = crypto.randomBytes(32).toString("hex");

  const wrapped = wrapKey(recordKey, masterKey);
  assert.ok(wrapped.ciphertext && typeof wrapped.ciphertext === "string");
  assert.ok(wrapped.iv && typeof wrapped.iv === "string");
  assert.ok(wrapped.tag && typeof wrapped.tag === "string");
  assert.equal(wrapped.iv.length, 24); // 12 bytes = 24 hex
  assert.equal(wrapped.tag.length, 32); // 16 bytes = 32 hex
  assert.equal(wrapped.ciphertext.length, 64); // 32 bytes = 64 hex

  // Unwrapping restores exact original key
  const unwrapped = unwrapKey(wrapped, masterKey);
  assert.equal(unwrapped, recordKey);

  // Wrapping again produces distinct IV and ciphertext (semantic security)
  const wrapped2 = wrapKey(recordKey, masterKey);
  assert.notEqual(wrapped.iv, wrapped2.iv);
  assert.notEqual(wrapped.ciphertext, wrapped2.ciphertext);
  assert.equal(unwrapKey(wrapped2, masterKey), recordKey);
});

// ── 3. Wrong master secret failure ──
test("unwrapKey: fails safely when attempting to unwrap with wrong master secret", () => {
  const masterKeyA = crypto.randomBytes(32);
  const masterKeyB = crypto.randomBytes(32);
  const recordKey = crypto.randomBytes(32).toString("hex");

  const wrapped = wrapKey(recordKey, masterKeyA);

  assert.throws(
    () => unwrapKey(wrapped, masterKeyB),
    (err) => {
      assert.match(err.message, /Failed to unwrap record encryption key/);
      // Ensure raw secrets are not leaked in error message
      assert.ok(!err.message.includes(recordKey));
      assert.ok(!err.message.includes(masterKeyA.toString("hex")));
      assert.ok(!err.message.includes(masterKeyB.toString("hex")));
      return true;
    }
  );
});

// ── 4. Tampered wrapped key failure ──
test("unwrapKey: rejects tampered ciphertext, iv, tag, and malformed inputs", () => {
  const masterKey = crypto.randomBytes(32);
  const recordKey = crypto.randomBytes(32).toString("hex");
  const wrapped = wrapKey(recordKey, masterKey);

  // Tamper ciphertext
  const tamperedCiphertext = {
    ...wrapped,
    ciphertext: (wrapped.ciphertext[0] === "a" ? "b" : "a") + wrapped.ciphertext.slice(1)
  };
  assert.throws(() => unwrapKey(tamperedCiphertext, masterKey), /Failed to unwrap record encryption key/);

  // Tamper IV
  const tamperedIv = {
    ...wrapped,
    iv: (wrapped.iv[0] === "a" ? "b" : "a") + wrapped.iv.slice(1)
  };
  assert.throws(() => unwrapKey(tamperedIv, masterKey), /Failed to unwrap record encryption key/);

  // Tamper auth tag
  const tamperedTag = {
    ...wrapped,
    tag: (wrapped.tag[0] === "a" ? "b" : "a") + wrapped.tag.slice(1)
  };
  assert.throws(() => unwrapKey(tamperedTag, masterKey), /Failed to unwrap record encryption key/);

  // Malformed structure / non-hex
  assert.throws(() => unwrapKey(null, masterKey), /Invalid wrapped key format/);
  assert.throws(() => unwrapKey({ ciphertext: "xyz" }, masterKey), /Invalid wrapped key format/);
  assert.throws(() => unwrapKey({ ...wrapped, iv: "zz".repeat(12) }, masterKey), /Malformed wrapped key components/);
});

// ── 5. resolveRecordKey: supports both wrapped and unmigrated entries ──
test("resolveRecordKey: unwraps wrappedKey, supports legacy encryptionKey, and rejects missing keys", () => {
  const masterKey = crypto.randomBytes(32);
  const plainKey = crypto.randomBytes(32).toString("hex");
  const wrapped = wrapKey(plainKey, masterKey);

  // Wrapped record
  const wrappedRecord = { id: "rec-1", wrappedKey: wrapped };
  assert.equal(resolveRecordKey(wrappedRecord, masterKey), plainKey);

  // Unmigrated legacy record
  const legacyRecord = { id: "rec-2", encryptionKey: plainKey };
  assert.equal(resolveRecordKey(legacyRecord, null), plainKey);
  assert.equal(resolveRecordKey(legacyRecord, masterKey), plainKey);

  // Wrapped record without master key fails
  assert.throws(() => resolveRecordKey(wrappedRecord, null), /Master encryption key is required/);

  // Record with neither key fails
  assert.throws(() => resolveRecordKey({ id: "rec-3" }, masterKey), /contains neither wrappedKey nor encryptionKey/);
});

// ── 6. Idempotent migration tests ──
test("migrateRecordsMetadata: wraps plain keys, creates timestamped backup, and is strictly idempotent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-migration-test-"));
  const recordsFile = path.join(tempDir, "records_metadata.json");
  const masterKey = crypto.randomBytes(32);

  const key1 = crypto.randomBytes(32).toString("hex");
  const key2 = crypto.randomBytes(32).toString("hex");

  const initialRecords = [
    {
      id: "rec-101",
      fileName: "report1.pdf",
      encryptedFileName: "enc_101.pdf",
      patientAddress: "0x1111111111111111111111111111111111111111",
      encryptionKey: key1,
      iv: "a".repeat(24),
      tag: "b".repeat(32)
    },
    {
      id: "rec-102",
      fileName: "report2.pdf",
      encryptedFileName: "enc_102.pdf",
      patientAddress: "0x2222222222222222222222222222222222222222",
      encryptionKey: key2,
      iv: "c".repeat(24),
      tag: "d".repeat(32)
    }
  ];

  fs.writeFileSync(recordsFile, JSON.stringify(initialRecords, null, 2), "utf8");

  // First migration run
  const res1 = migrateRecordsMetadata({ uploadsDir: tempDir, masterKeyBuffer: masterKey });
  assert.equal(res1.migrated, true);
  assert.equal(res1.count, 2);
  assert.ok(fs.existsSync(res1.backupPath));

  // Verify backup contains the exact original plain keys
  const backupContent = JSON.parse(fs.readFileSync(res1.backupPath, "utf8"));
  assert.equal(backupContent.length, 2);
  assert.equal(backupContent[0].encryptionKey, key1);
  assert.equal(backupContent[1].encryptionKey, key2);
  assert.equal(backupContent[0].wrappedKey, undefined);

  // Verify main file has wrapped keys and NO plaintext encryptionKey
  const migratedRecords = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
  assert.equal(migratedRecords.length, 2);
  assert.equal(migratedRecords[0].encryptionKey, undefined);
  assert.equal(migratedRecords[1].encryptionKey, undefined);
  assert.ok(migratedRecords[0].wrappedKey);
  assert.ok(migratedRecords[1].wrappedKey);

  // Verify wrapped keys can be unwrapped to original plain keys
  assert.equal(unwrapKey(migratedRecords[0].wrappedKey, masterKey), key1);
  assert.equal(unwrapKey(migratedRecords[1].wrappedKey, masterKey), key2);

  // Second migration run (idempotency check)
  const filesBeforeSecond = fs.readdirSync(tempDir);
  const backupCountBefore = filesBeforeSecond.filter(f => f.startsWith("records_metadata.backup-")).length;
  assert.equal(backupCountBefore, 1);

  const res2 = migrateRecordsMetadata({ uploadsDir: tempDir, masterKeyBuffer: masterKey });
  assert.equal(res2.migrated, false);
  assert.equal(res2.count, 0);
  assert.equal(res2.reason, "already-migrated");

  const filesAfterSecond = fs.readdirSync(tempDir);
  const backupCountAfter = filesAfterSecond.filter(f => f.startsWith("records_metadata.backup-")).length;
  assert.equal(backupCountAfter, 1, "Second run must NOT create duplicate backups");

  // Metadata file remains completely intact and wrapped
  const recordsAfterSecond = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
  assert.equal(unwrapKey(recordsAfterSecond[0].wrappedKey, masterKey), key1);
  assert.equal(unwrapKey(recordsAfterSecond[1].wrappedKey, masterKey), key2);

  // Clean up test directory
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── 7. Viewing both migrated, unmigrated, and newly uploaded records ──
test("records router: views both migrated and unmigrated records, and wraps newly uploaded records", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-records-view-test-"));
  const recordsFile = path.join(tempDir, "records_metadata.json");
  const masterKey = crypto.randomBytes(32);

  const patientWallet = ethers.Wallet.createRandom();
  const patientAddr = patientWallet.address.toLowerCase();
  const patientToken = jwt.sign({ address: patientAddr }, TEST_JWT_SECRET, { expiresIn: "1h" });

  // 1. Prepare Migrated Record (wrappedKey)
  const samplePdf1 = createSamplePdf("Migrated Record Content");
  const key1 = crypto.randomBytes(32);
  const iv1 = crypto.randomBytes(12);
  const cipher1 = crypto.createCipheriv("aes-256-gcm", key1, iv1);
  const encData1 = Buffer.concat([cipher1.update(samplePdf1), cipher1.final()]);
  const encFile1 = "enc_migrated.pdf";
  fs.writeFileSync(path.join(tempDir, encFile1), encData1);

  const wrappedKey1 = wrapKey(key1, masterKey);

  // 2. Prepare Unmigrated Legacy Record (encryptionKey)
  const samplePdf2 = createSamplePdf("Unmigrated Record Content");
  const key2 = crypto.randomBytes(32);
  const iv2 = crypto.randomBytes(12);
  const cipher2 = crypto.createCipheriv("aes-256-gcm", key2, iv2);
  const encData2 = Buffer.concat([cipher2.update(samplePdf2), cipher2.final()]);
  const encFile2 = "enc_unmigrated.pdf";
  fs.writeFileSync(path.join(tempDir, encFile2), encData2);

  const existingRecords = [
    {
      id: "rec-migrated",
      fileName: "migrated.pdf",
      encryptedFileName: encFile1,
      patientAddress: patientAddr,
      doctorAddress: "0x0000000000000000000000000000000000000001",
      doctorName: "Dr. Arjun Sharma",
      recordType: "report",
      ipfsHash: "QmMigrated",
      wrappedKey: wrappedKey1,
      iv: iv1.toString("hex"),
      tag: cipher1.getAuthTag().toString("hex"),
      uploadedAt: new Date().toISOString(),
      fileType: "application/pdf"
    },
    {
      id: "rec-unmigrated",
      fileName: "unmigrated.pdf",
      encryptedFileName: encFile2,
      patientAddress: patientAddr,
      doctorAddress: "0x0000000000000000000000000000000000000001",
      doctorName: "Dr. Arjun Sharma",
      recordType: "prescription",
      ipfsHash: "QmUnmigrated",
      encryptionKey: key2.toString("hex"), // Plain key (legacy)
      iv: iv2.toString("hex"),
      tag: cipher2.getAuthTag().toString("hex"),
      uploadedAt: new Date().toISOString(),
      fileType: "application/pdf"
    }
  ];

  fs.writeFileSync(recordsFile, JSON.stringify(existingRecords, null, 2), "utf8");

  // Create router with masterKey injected
  const app = express();
  app.use(express.json());
  const router = createRecordRouter({
    uploadsDir: tempDir,
    masterKey,
    hasAccess: async () => true
  });
  app.use("/records", router);

  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}/records`;

  // A. View migrated record: must successfully decrypt and deliver original PDF
  const resMigrated = await fetch(`${base}/view/rec-migrated`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(resMigrated.status, 200);
  assert.equal(resMigrated.headers.get("content-type"), "application/pdf");
  const bodyMigrated = Buffer.from(await resMigrated.arrayBuffer());
  assert.deepEqual(bodyMigrated, samplePdf1);

  // B. View unmigrated legacy record: must also successfully decrypt and deliver original PDF
  const resUnmigrated = await fetch(`${base}/view/rec-unmigrated`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(resUnmigrated.status, 200);
  assert.equal(resUnmigrated.headers.get("content-type"), "application/pdf");
  const bodyUnmigrated = Buffer.from(await resUnmigrated.arrayBuffer());
  assert.deepEqual(bodyUnmigrated, samplePdf2);

  // C. Upload a new record via multipart/form-data
  const newPdfContent = createSamplePdf("Brand New Record Content");
  const boundary = "----FormBoundary" + crypto.randomBytes(8).toString("hex");
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientAddress"\r\n\r\n${patientAddr}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="recordType"\r\n\r\nreport\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="new_report.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    newPdfContent,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`${base}/upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${patientToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: multipartBody
  });

  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.success, true);
  const newRecordId = uploadData.recordId;

  // Verify the metadata on disk for the newly uploaded record: has wrappedKey and NO plain encryptionKey
  const metadataOnDisk = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
  const newRecordOnDisk = metadataOnDisk.find(r => r.id === newRecordId);
  assert.ok(newRecordOnDisk, "New record must exist in metadata on disk");
  assert.ok(newRecordOnDisk.wrappedKey, "New record must have wrappedKey");
  assert.equal(newRecordOnDisk.encryptionKey, undefined, "New record must NOT have plain encryptionKey");

  // D. View newly uploaded record: decrypts and matches uploaded PDF
  const resNew = await fetch(`${base}/view/${newRecordId}`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(resNew.status, 200);
  const bodyNew = Buffer.from(await resNew.arrayBuffer());
  assert.deepEqual(bodyNew, newPdfContent);
});

// ── 8. Server startup refusal on missing or malformed RECORD_KEY_ENCRYPTION_SECRET ──
test("server startup: refuses to start with code 1 and clear error if master secret is missing or malformed", async () => {
  const { execFile } = await import("child_process");
  const serverPath = path.resolve("server.js");

  // A. Missing secret
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [serverPath],
      { env: { ...process.env, RECORD_KEY_ENCRYPTION_SECRET: "" } },
      (err, stdout, stderr) => {
        assert.ok(err, "Process must exit with error");
        assert.equal(err.code, 1);
        assert.match(stderr, /FATAL: Failed to start server due to invalid RECORD_KEY_ENCRYPTION_SECRET/);
        assert.match(stderr, /RECORD_KEY_ENCRYPTION_SECRET is required/);
        resolve();
      }
    );
  });

  // B. Malformed secret (invalid hex or wrong length)
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [serverPath],
      { env: { ...process.env, RECORD_KEY_ENCRYPTION_SECRET: "short-and-not-hex" } },
      (err, stdout, stderr) => {
        assert.ok(err, "Process must exit with error");
        assert.equal(err.code, 1);
        assert.match(stderr, /FATAL: Failed to start server due to invalid RECORD_KEY_ENCRYPTION_SECRET/);
        assert.match(stderr, /64-character hexadecimal string/);
        resolve();
      }
    );
  });
});
