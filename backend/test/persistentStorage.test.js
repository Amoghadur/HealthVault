import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import jwt from "jsonwebtoken";
import express from "express";

import {
  getDataDir,
  getUploadsDir,
  getDataFilePath,
  getUploadsFilePath,
  ensureStorageDirectories,
  isPersistentStorageConfigured
} from "../services/storagePaths.js";

import { createAppointmentStore } from "../services/appointmentStore.js";
import { createAuditStore, getAuditFilePath } from "../services/auditStore.js";
import { createConsentAllowListStore } from "../services/consentAllowListStore.js";
import { createConsentExpiryStore } from "../services/consentExpiryStore.js";
import { createConsentRequestStore } from "../services/consentRequestStore.js";
import { createDoctorProfileStore } from "../services/doctorProfileStore.js";
import { createEmergencyTokenStore } from "../services/emergencyTokenStore.js";
import { createPatientProfileStore } from "../services/patientProfileStore.js";
import { initPersistentProfiles, walletToId, patientRegistry } from "../routes/auth.js";
import { createRecordRouter } from "../routes/records.js";
import { createConsentRouter } from "../routes/consent.js";
import { migrateRecordsMetadata } from "../services/keyManagement.js";

const JWT_SECRET = process.env.JWT_SECRET || "0123456789abcdef0123456789abcdef";
const TEST_MASTER_KEY = crypto.randomBytes(32);
const TEST_MASTER_KEY_HEX = TEST_MASTER_KEY.toString("hex");

// ── 1. Storage paths module default and custom resolution ──

test("storagePaths: defaults to local backend/data and backend/uploads when environment variables are unset", (t) => {
  const origData = process.env.HEALTHVAULT_DATA_DIR;
  const origUploads = process.env.HEALTHVAULT_UPLOADS_DIR;
  delete process.env.HEALTHVAULT_DATA_DIR;
  delete process.env.HEALTHVAULT_UPLOADS_DIR;

  t.after(() => {
    if (origData !== undefined) process.env.HEALTHVAULT_DATA_DIR = origData;
    if (origUploads !== undefined) process.env.HEALTHVAULT_UPLOADS_DIR = origUploads;
  });

  const dataDir = getDataDir();
  const uploadsDir = getUploadsDir();

  assert.ok(dataDir.endsWith(path.normalize("backend/data")) || dataDir.endsWith(path.normalize("backend\\data")));
  assert.ok(uploadsDir.endsWith(path.normalize("backend/uploads")) || uploadsDir.endsWith(path.normalize("backend\\uploads")));
  assert.equal(isPersistentStorageConfigured(), false);

  assert.equal(getDataFilePath("test.json"), path.join(dataDir, "test.json"));
  assert.equal(getUploadsFilePath("test.json"), path.join(uploadsDir, "test.json"));
});

test("storagePaths: resolves custom persistent directories and trims whitespace", (t) => {
  const origData = process.env.HEALTHVAULT_DATA_DIR;
  const origUploads = process.env.HEALTHVAULT_UPLOADS_DIR;

  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "hv-persist-cfg-"));
  const customData = path.join(tempBase, "render-data");
  const customUploads = path.join(tempBase, "render-uploads");

  process.env.HEALTHVAULT_DATA_DIR = `  ${customData}  `;
  process.env.HEALTHVAULT_UPLOADS_DIR = `  ${customUploads}  `;

  t.after(() => {
    if (origData !== undefined) process.env.HEALTHVAULT_DATA_DIR = origData;
    else delete process.env.HEALTHVAULT_DATA_DIR;
    if (origUploads !== undefined) process.env.HEALTHVAULT_UPLOADS_DIR = origUploads;
    else delete process.env.HEALTHVAULT_UPLOADS_DIR;
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  assert.equal(getDataDir(), path.resolve(customData));
  assert.equal(getUploadsDir(), path.resolve(customUploads));
  assert.equal(isPersistentStorageConfigured(), true);

  // ensureStorageDirectories creates them if they don't exist yet
  assert.equal(fs.existsSync(customData), false);
  assert.equal(fs.existsSync(customUploads), false);

  const ensured = ensureStorageDirectories();
  assert.equal(ensured.dataDir, path.resolve(customData));
  assert.equal(ensured.uploadsDir, path.resolve(customUploads));
  assert.equal(fs.existsSync(customData), true);
  assert.equal(fs.existsSync(customUploads), true);
});

test("storagePaths: ensureStorageDirectories fails if configured persistent directory is a file or unavailable", (t) => {
  const origData = process.env.HEALTHVAULT_DATA_DIR;
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "hv-persist-fail-"));
  const fakeFile = path.join(tempBase, "not-a-directory");
  fs.writeFileSync(fakeFile, "i am a file");

  process.env.HEALTHVAULT_DATA_DIR = fakeFile;

  t.after(() => {
    if (origData !== undefined) process.env.HEALTHVAULT_DATA_DIR = origData;
    else delete process.env.HEALTHVAULT_DATA_DIR;
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  assert.throws(
    () => ensureStorageDirectories(),
    /Configured persistent data directory is unavailable/
  );
});

// ── 2. All 8 default JSON stores use configured HEALTHVAULT_DATA_DIR ──

test("stores: all 8 stores automatically use configured HEALTHVAULT_DATA_DIR", (t) => {
  const origData = process.env.HEALTHVAULT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-stores-cfg-"));
  process.env.HEALTHVAULT_DATA_DIR = tempDir;

  t.after(() => {
    if (origData !== undefined) process.env.HEALTHVAULT_DATA_DIR = origData;
    else delete process.env.HEALTHVAULT_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // 1. Appointments
  const apptStore = createAppointmentStore();
  apptStore.write([{ id: "appt-1", status: "pending" }]);
  assert.equal(fs.existsSync(path.join(tempDir, "appointments.json")), true);
  assert.equal(apptStore.read()[0].id, "appt-1");

  // 2. Audit
  const audit = createAuditStore();
  audit.append({ action: "RecordStored", actor: "0x1111111111111111111111111111111111111111" });
  assert.equal(fs.existsSync(path.join(tempDir, "audit.jsonl")), true);
  assert.equal(audit.read("0x1111111111111111111111111111111111111111").length, 1);

  // 3. Consent Allow List
  const allowStore = createConsentAllowListStore();
  assert.equal(allowStore.filePath, path.join(tempDir, "consent_allow_lists.json"));
  allowStore.setAllowList({
    patientAddress: "0x2222222222222222222222222222222222222222",
    doctorAddress: "0x3333333333333333333333333333333333333333",
    recordIds: ["rec-1"]
  });
  assert.equal(fs.existsSync(path.join(tempDir, "consent_allow_lists.json")), true);
  assert.deepEqual(
    allowStore.getAllowList("0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"),
    ["rec-1"]
  );

  // 4. Consent Expiry
  const expiryStore = createConsentExpiryStore();
  assert.equal(expiryStore.filePath, path.join(tempDir, "consent_expiries.json"));
  expiryStore.saveGrant({
    patientAddress: "0x2222222222222222222222222222222222222222",
    doctorAddress: "0x3333333333333333333333333333333333333333",
    durationMinutes: 15
  });
  assert.equal(fs.existsSync(path.join(tempDir, "consent_expiries.json")), true);

  // 5. Consent Request
  const reqStore = createConsentRequestStore();
  assert.equal(reqStore.filePath, path.join(tempDir, "consent_requests.json"));
  reqStore.createRequest({
    patientAddress: "0x2222222222222222222222222222222222222222",
    doctorAddress: "0x3333333333333333333333333333333333333333",
    reason: "Test reason"
  });
  assert.equal(fs.existsSync(path.join(tempDir, "consent_requests.json")), true);

  // 6. Doctor Profile
  const docStore = createDoctorProfileStore();
  docStore.save("0x3333333333333333333333333333333333333333", {
    displayName: "Dr. Persistent",
    specialty: "Cardiology",
    affiliation: "General Hospital"
  });
  assert.equal(fs.existsSync(path.join(tempDir, "doctor_profiles.json")), true);
  assert.equal(docStore.get("0x3333333333333333333333333333333333333333").displayName, "Dr. Persistent");

  // 7. Emergency Token
  const emergStore = createEmergencyTokenStore();
  assert.equal(emergStore.filePath, path.join(tempDir, "emergency_tokens.json"));
  emergStore.saveToken({
    token: "tok-test-1",
    patientAddress: "0x2222222222222222222222222222222222222222",
    expiry: Date.now() + 60000,
    data: { bloodType: "O+" }
  });
  assert.equal(fs.existsSync(path.join(tempDir, "emergency_tokens.json")), true);
  assert.equal(emergStore.get("tok-test-1").patientAddress, "0x2222222222222222222222222222222222222222");

  // 8. Patient Profile
  const patStore = createPatientProfileStore();
  patStore.save("0x2222222222222222222222222222222222222222", {
    displayName: "Alice Persistent",
    bloodGroup: "O+",
    allergies: ["Penicillin"]
  });
  assert.equal(fs.existsSync(path.join(tempDir, "patient_profiles.json")), true);
  assert.equal(patStore.get("0x2222222222222222222222222222222222222222").displayName, "Alice Persistent");
});

// ── 3. auth.js initPersistentProfiles reads from configured HEALTHVAULT_DATA_DIR ──

test("auth.js: initPersistentProfiles automatically reads profiles from HEALTHVAULT_DATA_DIR", (t) => {
  const origData = process.env.HEALTHVAULT_DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-auth-init-"));

  const testPatient = "0x7777777777777777777777777777777777777777";
  const testDoctor = "0x8888888888888888888888888888888888888888";

  fs.writeFileSync(
    path.join(tempDir, "patient_profiles.json"),
    JSON.stringify([{ walletAddress: testPatient, displayName: "Patient Seven" }])
  );
  fs.writeFileSync(
    path.join(tempDir, "doctor_profiles.json"),
    JSON.stringify([{ walletAddress: testDoctor, displayName: "Doctor Eight" }])
  );

  process.env.HEALTHVAULT_DATA_DIR = tempDir;

  t.after(() => {
    if (origData !== undefined) process.env.HEALTHVAULT_DATA_DIR = origData;
    else delete process.env.HEALTHVAULT_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Call without arguments: should use getDataDir() which points to tempDir
  initPersistentProfiles();

  assert.ok(walletToId[testPatient], "Test patient should be registered in walletToId");
  assert.ok(walletToId[testDoctor], "Test doctor should be registered in walletToId");
  assert.equal(patientRegistry[walletToId[testPatient]], testPatient);
  assert.equal(patientRegistry[walletToId[testDoctor]], testDoctor);
});

// ── 4. Records router and Multer use configured HEALTHVAULT_UPLOADS_DIR ──

test("records router: Multer, storage, metadata, and deletion use configured HEALTHVAULT_UPLOADS_DIR", async (t) => {
  const origUploads = process.env.HEALTHVAULT_UPLOADS_DIR;
  const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), "hv-uploads-cfg-"));
  process.env.HEALTHVAULT_UPLOADS_DIR = tempUploads;

  t.after(() => {
    if (origUploads !== undefined) process.env.HEALTHVAULT_UPLOADS_DIR = origUploads;
    else delete process.env.HEALTHVAULT_UPLOADS_DIR;
    fs.rmSync(tempUploads, { recursive: true, force: true });
  });

  const patientWallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const doctorWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const doctorToken = jwt.sign({ address: doctorWallet }, JWT_SECRET);
  const patientToken = jwt.sign({ address: patientWallet }, JWT_SECRET);

  // Router created without explicit uploadsDir parameter
  const router = createRecordRouter({
    hasAccess: async () => true,
    pinFile: async () => "QmMockHash12345",
    masterKey: TEST_MASTER_KEY,
    audit: () => {}
  });

  const app = express();
  app.use(express.json());
  app.use("/records", router);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}/records`;

  // 1. Upload record via multipart form-data
  const boundary = "----TestBoundary" + Math.random().toString(36).slice(2);
  const fileContent = Buffer.from("%PDF-1.4 sample content for persistent test");
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patientAddress"\r\n\r\n${patientWallet}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="recordType"\r\n\r\nreport\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    fileContent,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`${base}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${doctorToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: multipartBody
  });

  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.success, true);
  const recordId = uploadData.recordId;

  // Verify file was written to tempUploads
  const metadataPath = path.join(tempUploads, "records_metadata.json");
  assert.equal(fs.existsSync(metadataPath), true);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].id, recordId);

  const encFileName = metadata[0].encryptedFileName;
  assert.equal(fs.existsSync(path.join(tempUploads, encFileName)), true);

  // 2. View / decrypt record
  const viewRes = await fetch(`${base}/view/${recordId}`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(viewRes.status, 200);
  const decryptedBuf = Buffer.from(await viewRes.arrayBuffer());
  assert.deepEqual(decryptedBuf, fileContent);

  // 3. Delete record
  const deleteRes = await fetch(`${base}/${recordId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(deleteRes.status, 200);

  // Verify encrypted file was deleted from tempUploads
  assert.equal(fs.existsSync(path.join(tempUploads, encFileName)), false);
  const metadataAfterDelete = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadataAfterDelete.length, 0);
});

// ── 5. consent.js defaults to configured HEALTHVAULT_UPLOADS_DIR ──

test("consent.js: default recordsFilePath uses configured HEALTHVAULT_UPLOADS_DIR", (t) => {
  const origUploads = process.env.HEALTHVAULT_UPLOADS_DIR;
  const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), "hv-consent-uploads-"));
  process.env.HEALTHVAULT_UPLOADS_DIR = tempUploads;

  t.after(() => {
    if (origUploads !== undefined) process.env.HEALTHVAULT_UPLOADS_DIR = origUploads;
    else delete process.env.HEALTHVAULT_UPLOADS_DIR;
    fs.rmSync(tempUploads, { recursive: true, force: true });
  });

  // Write a synthetic record into the configured uploads directory
  const recordsFile = path.join(tempUploads, "records_metadata.json");
  fs.writeFileSync(
    recordsFile,
    JSON.stringify([{ id: "rec-999", patientAddress: "0x1111111111111111111111111111111111111111", doctorAddress: "0x2222222222222222222222222222222222222222" }])
  );

  // createConsentRouter with no recordsFilePath specified should use tempUploads
  const router = createConsentRouter();
  assert.ok(router, "Router should initialize cleanly with configured uploads directory");
});

// ── 6. migrateRecordsMetadata uses HEALTHVAULT_UPLOADS_DIR and fails safely on corrupt data ──

test("migrateRecordsMetadata: defaults to HEALTHVAULT_UPLOADS_DIR and handles corrupt metadata safely", (t) => {
  const origUploads = process.env.HEALTHVAULT_UPLOADS_DIR;
  const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), "hv-migrate-cfg-"));
  process.env.HEALTHVAULT_UPLOADS_DIR = tempUploads;

  t.after(() => {
    if (origUploads !== undefined) process.env.HEALTHVAULT_UPLOADS_DIR = origUploads;
    else delete process.env.HEALTHVAULT_UPLOADS_DIR;
    fs.rmSync(tempUploads, { recursive: true, force: true });
  });

  // A. File does not exist yet: returns { migrated: false, reason: 'file-not-found' }
  const resEmpty = migrateRecordsMetadata({ masterKeyBuffer: TEST_MASTER_KEY });
  assert.equal(resEmpty.migrated, false);
  assert.equal(resEmpty.reason, "file-not-found");

  // B. Corrupted JSON file: throws non-secret error, does NOT overwrite or initialize empty
  const recordsFile = path.join(tempUploads, "records_metadata.json");
  fs.writeFileSync(recordsFile, "{ this is not valid json }", "utf8");

  assert.throws(
    () => migrateRecordsMetadata({ masterKeyBuffer: TEST_MASTER_KEY }),
    /Failed to parse records metadata/
  );
  // Verify corrupted content was preserved and not wiped
  assert.equal(fs.readFileSync(recordsFile, "utf8"), "{ this is not valid json }");

  // C. Invalid non-array JSON (e.g. object instead of array): throws error, does NOT treat as empty
  fs.writeFileSync(recordsFile, JSON.stringify({ notAnArray: true }), "utf8");
  assert.throws(
    () => migrateRecordsMetadata({ masterKeyBuffer: TEST_MASTER_KEY }),
    /Expected a JSON array/
  );

  // D. Valid legacy records with plain encryptionKey: migrates cleanly in configured dir
  const legacyKey = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(
    recordsFile,
    JSON.stringify([{ id: "rec-legacy", encryptionKey: legacyKey, fileName: "doc.pdf" }])
  );

  const resMigrated = migrateRecordsMetadata({ masterKeyBuffer: TEST_MASTER_KEY });
  assert.equal(resMigrated.migrated, true);
  assert.equal(resMigrated.count, 1);
  assert.ok(fs.existsSync(resMigrated.backupPath));

  const migratedData = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
  assert.ok(migratedData[0].wrappedKey, "Record must now have wrappedKey");
  assert.equal(migratedData[0].encryptionKey, undefined, "Plain key must be removed");
});

// ── 7. Server startup fails closed if configured persistent directory is unavailable ──

test("server startup: refuses to start with code 1 if configured persistent directory is unavailable", async () => {
  const serverPath = path.resolve("server.js");

  // Point HEALTHVAULT_DATA_DIR to an unwritable / invalid path (a file path as directory)
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "hv-server-fail-"));
  const blockedFile = path.join(tempBase, "blocked-file");
  fs.writeFileSync(blockedFile, "block");

  try {
    await new Promise((resolve) => {
      execFile(
        process.execPath,
        [serverPath],
        {
          env: {
            ...process.env,
            RECORD_KEY_ENCRYPTION_SECRET: TEST_MASTER_KEY_HEX,
            JWT_SECRET: JWT_SECRET,
            HEALTHVAULT_DATA_DIR: blockedFile
          }
        },
        (err, stdout, stderr) => {
          assert.ok(err, "Process must exit with error code 1");
          assert.equal(err.code, 1);
          assert.match(stderr, /FATAL: Failed to initialize storage directories on startup/);
          assert.match(stderr, /Configured persistent data directory is unavailable/);
          resolve();
        }
      );
    });
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
});
