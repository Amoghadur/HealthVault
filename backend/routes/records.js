import express from "express";
import { ethers } from "ethers";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/authMiddleware.js";
import dotenv from "dotenv";
import { recordActivity } from "../services/auditStore.js";
import { createUploadAuthorization } from "../middleware/recordAccess.js";
import { readCurrentAccess } from "../services/blockchain.js";
import { defaultExpiryStore } from "../services/consentExpiryStore.js";
import { defaultConsentAllowListStore } from "../services/consentAllowListStore.js";
import { wrapKey, resolveRecordKey, validateMasterSecret } from "../services/keyManagement.js";
import { createRecordUploadRateLimiter } from "../middleware/rateLimiting.js";
import { getUploadsDir } from "../services/storagePaths.js";
dotenv.config();

// Injectable storage and external services keep route tests isolated from real records.
export function createRecordRouter({
  uploadsDir = getUploadsDir(),
  hasAccess = readCurrentAccess,
  audit = recordActivity,
  pinFile,
  expiryStore = (hasAccess === readCurrentAccess ? defaultExpiryStore : null),
  allowListStore = defaultConsentAllowListStore,
  consentTimeoutMs = 20_000,
  masterSecret = process.env.RECORD_KEY_ENCRYPTION_SECRET,
  masterKey,
  uploadRateLimiter = createRecordUploadRateLimiter(),
  allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "http://localhost:5173")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean)
} = {}) {
  const router = express.Router();

  let masterKeyBuffer = null;
  if (masterKey && Buffer.isBuffer(masterKey) && masterKey.length === 32) {
    masterKeyBuffer = masterKey;
  } else if (masterSecret) {
    try {
      masterKeyBuffer = validateMasterSecret(masterSecret);
    } catch {
      masterKeyBuffer = null;
    }
  }

  // Read-only RPC checks may stall; never authorize from an unknown outcome.
  async function boundedConsentCheck(patient, doctor) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => hasAccess(patient, doctor)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Consent verification timed out")), consentTimeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  function sessionStillValid(token, address) {
    try {
      const current = jwt.verify(token, process.env.JWT_SECRET);
      return typeof current.address === "string" && current.address.toLowerCase() === address;
    } catch { return false; }
  }

  // ── Ensure uploads folder exists ──
  const UPLOADS_DIR = uploadsDir;
  const RECORDS_FILE = path.join(UPLOADS_DIR, "records_metadata.json");

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log("Created uploads directory");
  }

  // ── Load records from disk on startup ──
  let uploadedRecords = [];
  if (fs.existsSync(RECORDS_FILE)) {
    let raw;
    try {
      raw = fs.readFileSync(RECORDS_FILE, "utf8");
    } catch (err) {
      throw new Error(`Failed to read records metadata from disk: ${err.message}`);
    }
    try {
      uploadedRecords = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse records metadata from disk: ${err.message}`);
    }
    if (!Array.isArray(uploadedRecords)) {
      throw new Error("Failed to parse records metadata from disk: Expected a JSON array.");
    }
    console.log(`Loaded ${uploadedRecords.length} records from disk`);
  } else {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify([], null, 2));
    console.log("Created empty records_metadata.json");
  }

  // ── Save records to disk ──
  function saveRecords() {
    try {
      fs.writeFileSync(RECORDS_FILE, JSON.stringify(uploadedRecords, null, 2));
      console.log(`Saved ${uploadedRecords.length} records to disk`);
    } catch (err) {
      console.error("Could not save records:", err.message);
    }
  }

  // ── Multer setup ──
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + "_" + file.originalname)
  });
  const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }
  });

  // ── Encrypt ──
  function encryptFile(filePath) {
    const keyHex = process.env.RECORD_ENCRYPTION_KEY;
    const key = keyHex ? Buffer.from(keyHex, "hex") : crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const input = fs.readFileSync(filePath);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted,
      key: key.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex")
    };
  }

  // ── Decrypt ──
  function decryptFile(encryptedData, keyHex, ivHex, tagHex) {
    const key = Buffer.from(keyHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  // ── Upload to Pinata ──
  async function uploadToPinata(encryptedBuffer, fileName) {
    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      console.log("No PINATA_JWT — using mock IPFS hash");
      return "Qm" + crypto.randomBytes(22).toString("hex");
    }
    try {
      const boundary = "----FormBoundary" + crypto.randomBytes(8).toString("hex");
      const header = Buffer.from([
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="file"; filename="encrypted_${fileName}"\r\n`,
        `Content-Type: application/octet-stream\r\n\r\n`
      ].join(""));
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, encryptedBuffer, footer]);
      const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${pinataJwt}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString()
        },
        body
      });
      if (!response.ok) {
        console.error("Pinata upload failed with status:", response.status);
        return "Qm" + crypto.randomBytes(22).toString("hex");
      }
      const result = await response.json();
      return result.IpfsHash;
    } catch (err) {
      console.error("Pinata failed:", err.message);
      return "Qm" + crypto.randomBytes(22).toString("hex");
    }
  }

  // ── POST /records/upload ──
  router.post("/upload", uploadRateLimiter, requireAuth, upload.single("file"), createUploadAuthorization({ hasAccess, audit, expiryStore }), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { patientAddress } = req.body;
    if (!patientAddress) return res.status(400).json({ error: "Patient address required" });
    const recordType = req.body.recordType === undefined ? "unspecified" : req.body.recordType;
    if (!["prescription", "report", "unspecified"].includes(recordType)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Record type must be prescription, report, or unspecified." });
    }

    try {
      console.log("Encrypting:", req.file.originalname);
      const { encrypted, key, iv, tag } = encryptFile(req.file.path);

      const encryptedFileName = "enc_" + Date.now() + "_" + req.file.originalname;
      const encryptedPath = path.join(UPLOADS_DIR, encryptedFileName);
      fs.writeFileSync(encryptedPath, encrypted);
      fs.unlinkSync(req.file.path);

      console.log("Uploading to IPFS...");
      const ipfsHash = await (pinFile || uploadToPinata)(encrypted, req.file.originalname);

      let wrappedKey;
      if (masterKeyBuffer) {
        wrappedKey = wrapKey(key, masterKeyBuffer);
      } else {
        throw new Error("Cannot save record: Master encryption key is not configured.");
      }

      const recordId = Date.now().toString();
      const record = {
        id: recordId,
        fileName: req.file.originalname,
        encryptedFileName,
        patientAddress: patientAddress.toLowerCase(),
        doctorAddress: req.user.address,
        doctorName: "Dr. Arjun Sharma",
        recordType,
        ipfsHash,
        wrappedKey,
        iv,
        tag,
        uploadedAt: new Date().toISOString(),
        fileType: req.file.mimetype || "application/pdf"
      };

      uploadedRecords.push(record);
      saveRecords(); // Save to disk immediately
      audit({ action: "RecordStored", actor: req.user.address, patient: record.patientAddress, recordId, outcome: "stored-locally" });

      console.log(`Record ${recordId} saved permanently for patient ${patientAddress}`);

      res.json({
        success: true,
        ipfsHash,
        recordId,
        fileName: req.file.originalname,
        message: "File encrypted with AES-256-GCM and stored permanently"
      });

    } catch (err) {
      console.error("Upload error:", err.message || "Upload failed");
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: "Upload failed: " + (err.message || "Unknown error") });
    }
  });

  // Uploader identity comes only from the signed session, never request parameters.
  router.get("/doctor", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const actor = req.user.address.toLowerCase();
    let records;
    try {
      records = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
      if (!Array.isArray(records)) throw new Error("Invalid records");
    } catch {
      return res.status(500).json({ error: "Could not load records." });
    }
    try {
      const consent = new Map(); // Deduplicate patient checks only within this request.
      const allowLists = new Map(); // Deduplicate allow-list lookups within this request.
      const visible = [];
      for (const record of records) {
        const patient = record.patientAddress.toLowerCase();
        if (expiryStore) {
          const grant = expiryStore.getActiveGrant(patient, actor);
          if (!grant) continue;
        }
        if (!consent.has(patient)) {
          const onChain = await hasAccess(patient, actor);
          if (!onChain && expiryStore) expiryStore.revoke(patient, actor);
          consent.set(patient, onChain);
        }
        if (!consent.get(patient)) continue;

        const uploaderNorm = record.doctorAddress ? record.doctorAddress.toLowerCase() : "";
        const isUploader = (uploaderNorm === actor);
        if (!allowLists.has(patient)) {
          const list = allowListStore?.getAllowList(patient, actor);
          // Fail closed: a grant with no allow-list shares NO records
          allowLists.set(patient, Array.isArray(list) ? list : []);
        }
        const patientAllowList = allowLists.get(patient);
        const isOnAllowList = patientAllowList.includes(record.id);

        // Doctor may see only: (a) records on allow-list, plus (b) records doctor uploaded themselves
        if (!isOnAllowList && !isUploader) continue;

        visible.push({
          id: record.id,
          fileName: record.fileName,
          patientAddress: patient,
          doctorAddress: uploaderNorm || null,
          uploadedAt: record.uploadedAt,
          recordType: record.recordType || "unspecified",
          fileType: record.fileType,
          ipfsHash: record.ipfsHash,
        });
      }
      visible.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
      return res.json({ records: visible });
    } catch {
      return res.status(503).json({ error: "Could not verify patient consent on-chain. Retry when the network is available." });
    }
  });

  // ── GET /records/patient ──
  // Patient fetches their records — always reads from disk
  router.get("/patient", requireAuth, (req, res) => {
    // Re-read from disk every time to ensure latest data
    try {
      if (fs.existsSync(RECORDS_FILE)) {
        const raw = fs.readFileSync(RECORDS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("Invalid records metadata");
        uploadedRecords = parsed;
      }
    } catch (err) {
      console.error("Error re-reading records:", err.message);
      return res.status(500).json({ error: "Could not load records." });
    }

    const addr = req.user.address.toLowerCase();
    const patientRecords = uploadedRecords
      .filter(r => (r.patientAddress || "").toLowerCase() === addr)
      .map(r => ({
        id: r.id,
        fileName: r.fileName,
        doctorName: r.doctorName,
        doctorAddress: r.doctorAddress?.toLowerCase() || "",
        recordType: r.recordType || "unspecified",
        ipfsHash: r.ipfsHash,
        uploadedAt: r.uploadedAt
      }));

    console.log(`Patient ${addr} fetched ${patientRecords.length} records`);
    res.json({ records: patientRecords });
  });

  // ── DELETE /records/:recordId ──
  // Patient deletes their own record
  router.delete("/:recordId", requireAuth, (req, res) => {
    const { recordId } = req.params;
    const addr = req.user.address.toLowerCase();

    const index = uploadedRecords.findIndex(r => r.id === recordId);
    if (index === -1) return res.status(404).json({ error: "Record not found" });
    if ((uploadedRecords[index].patientAddress || "").toLowerCase() !== addr) {
      return res.status(403).json({ error: "Access denied" });
    }

    const record = uploadedRecords[index];

    // Delete encrypted file from disk
    const encryptedPath = path.join(UPLOADS_DIR, record.encryptedFileName);
    if (fs.existsSync(encryptedPath)) {
      fs.unlinkSync(encryptedPath);
      console.log(`Deleted file: ${record.encryptedFileName}`);
    }

    // Remove from array and save
    uploadedRecords.splice(index, 1);
    saveRecords();

    audit({ action: "RecordDeleted", actor: addr, patient: addr, recordId });

    console.log(`Record ${recordId} deleted by patient ${addr}`);
    res.json({ success: true, message: "Record deleted permanently" });
  });

  // ── GET /records/view/:recordId ──
  // Patients and currently consented uploaders view the original decrypted PDF.
  router.get("/view/:recordId", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const origins = (process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean) : allowedOrigins);
    res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${origins.join(" ")}`);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token) return res.status(401).send("Not authenticated");

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (typeof decoded.address !== "string" || !ethers.isAddress(decoded.address)) throw new Error("Invalid wallet");
    } catch {
      return res.status(401).send("Session expired. Please log in again.");
    }

    const addr = decoded.address.toLowerCase();
    const { recordId } = req.params;

    // Always read fresh from disk
    try {
      uploadedRecords = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
      if (!Array.isArray(uploadedRecords)) throw new Error("Invalid records");
    } catch (err) {
      return res.status(500).send("Could not load records");
    }

    const record = uploadedRecords.find(r => r.id === recordId);
    if (!record) return res.status(404).send("Record not found");
    const patientAddrNorm = record.patientAddress ? record.patientAddress.toLowerCase() : "";
    if (patientAddrNorm !== addr) {
      const uploaderNorm = record.doctorAddress ? record.doctorAddress.toLowerCase() : "";
      const isUploader = (uploaderNorm === addr);
      const allowList = allowListStore?.getAllowList(patientAddrNorm, addr);
      const onAllowList = Array.isArray(allowList) && allowList.includes(record.id);

      // Doctor may see/open ONLY: (a) records on allow-list, plus (b) records doctor uploaded themselves
      if (!isUploader && !onAllowList) {
        audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "not-on-allowlist" });
        return res.status(403).send("Access denied. Current patient consent and uploader ownership are required.");
      }

      let allowed = false;
      try {
        if (expiryStore && !expiryStore.getActiveGrant(patientAddrNorm, addr)) {
          audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "expired-or-missing" });
          return res.status(403).send("Access denied. Patient access consent has expired or has not been granted.");
        }
      } catch {
        return res.status(503).send("Could not verify patient consent. Please retry later.");
      }

      try { allowed = await boundedConsentCheck(patientAddrNorm, addr); }
      catch {
        audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "consent-unavailable" });
        return res.status(503).send("Could not verify patient consent on Sepolia. Please retry later.");
      }

      if (res.destroyed) return;
      if (!sessionStillValid(token, addr)) return res.status(401).send("Session expired. Please log in again.");

      try {
        if (allowed && expiryStore && !expiryStore.getActiveGrant(patientAddrNorm, addr)) {
          audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "expired-or-missing" });
          return res.status(403).send("Access denied. Patient access consent has expired or has been revoked.");
        }
      } catch {
        return res.status(503).send("Could not verify patient consent. Please retry later.");
      }

      if (!allowed) {
        if (expiryStore && isUploader) expiryStore.revoke(patientAddrNorm, addr);
        audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "denied" });
        return res.status(403).send("Access denied. Current patient consent and uploader ownership are required.");
      }

      // Re-verify allow-list hasn't changed during async consent check
      const currentAllowList = allowListStore?.getAllowList(patientAddrNorm, addr);
      const currentOnAllowList = Array.isArray(currentAllowList) && currentAllowList.includes(record.id);
      if (!isUploader && !currentOnAllowList) {
        audit({ action: "RecordAccessDenied", actor: addr, patient: patientAddrNorm, recordId, outcome: "not-on-allowlist" });
        return res.status(403).send("Access denied. Current patient consent and uploader ownership are required.");
      }

      // Consent checking is asynchronous: do not serve a record deleted while it ran.
      try {
        const currentRecords = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8"));
        if (!currentRecords.some(r => r.id === record.id)) return res.status(404).send("Record not found");
      } catch { return res.status(500).send("Could not load records"); }
    }

    try {
      const encryptedPath = path.join(UPLOADS_DIR, record.encryptedFileName);
      if (!fs.existsSync(encryptedPath)) {
        return res.status(404).send("Encrypted file not found on server");
      }

      const encryptedData = fs.readFileSync(encryptedPath);
      const rawKeyHex = resolveRecordKey(record, masterKeyBuffer);
      const decrypted = decryptFile(
        encryptedData,
        rawKeyHex,
        record.iv,
        record.tag
      );

      // A grant or JWT may reach its deadline while reading/decrypting the file.
      if (res.destroyed) return;
      if (!sessionStillValid(token, addr)) return res.status(401).send("Session expired. Please log in again.");
      if (record.patientAddress !== addr) {
        if (expiryStore && !expiryStore.getActiveGrant(record.patientAddress, addr)) {
          audit({ action: "RecordAccessDenied", actor: addr, patient: record.patientAddress, recordId, outcome: "expired-or-missing" });
          return res.status(403).send("Access denied. Patient access consent has expired or has been revoked.");
        }
        const isUploader = (record.doctorAddress?.toLowerCase() === addr);
        const finalAllowList = allowListStore?.getAllowList(record.patientAddress, addr);
        const finalOnAllowList = Array.isArray(finalAllowList) && finalAllowList.includes(record.id);
        if (!isUploader && !finalOnAllowList) {
          audit({ action: "RecordAccessDenied", actor: addr, patient: record.patientAddress, recordId, outcome: "not-on-allowlist" });
          return res.status(403).send("Access denied. Current patient consent and uploader ownership are required.");
        }
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${record.fileName}"`);
      res.once("finish", () => {
        if (res.statusCode === 200) audit({ action: "RecordServed", actor: addr, patient: record.patientAddress, recordId, outcome: "response-sent" });
      });
      res.send(decrypted);

      console.log(`Record ${recordId} viewed and decrypted for patient ${addr}`);

    } catch (err) {
      console.error("View error:", err.message || "Could not decrypt record");
      res.status(500).send("Could not decrypt: " + (err.message || "Decryption failed"));
    }
  });

  // ── GET /records/check/:patientAddress ──
  router.get("/check/:patientAddress", requireAuth, async (req, res) => {
    const { patientAddress } = req.params;
    const actor = req.user.address.toLowerCase();
    const patient = patientAddress.toLowerCase();
    if (patient === actor) {
      return res.json({ hasAccess: true, doctorAddress: req.user.address, patientAddress, status: "self" });
    }
    try {
      if (expiryStore) {
        const grant = expiryStore.getActiveGrant(patient, actor);
        if (!grant) {
          const stored = expiryStore.get(patient, actor);
          const status = stored?.revokedAt ? "revoked" : (stored ? "expired" : "none");
          return res.json({ hasAccess: false, doctorAddress: req.user.address, patientAddress, status });
        }
      }
      const onChain = await boundedConsentCheck(patient, actor);
      if (res.destroyed) return;
      if (!sessionStillValid(req.headers.authorization.split(" ")[1], actor)) {
        return res.status(401).json({ error: "Session expired. Please log in again." });
      }
      if (!onChain && expiryStore) expiryStore.revoke(patient, actor);
      const grant = expiryStore?.getActiveGrant(patient, actor);
      if (expiryStore && !grant) {
        const stored = expiryStore.get(patient, actor);
        const status = stored?.revokedAt ? "revoked" : (stored ? "expired" : "none");
        return res.json({ hasAccess: false, doctorAddress: req.user.address, patientAddress, status });
      }
      res.json({
        hasAccess: onChain,
        doctorAddress: req.user.address,
        patientAddress,
        status: onChain ? "active" : "revoked",
        expiresAt: grant?.expiresAt,
        remainingSeconds: grant ? Math.max(0, Math.round((Date.parse(grant.expiresAt) - Date.now()) / 1000)) : 0,
      });
    } catch {
      if (!res.destroyed) res.status(503).json({ error: "Could not verify patient consent on Sepolia. Please retry later.", status: "verification-unavailable" });
    }
  });

  return router;
}

// Initialize production storage only when serving a request, not when importing tests.
let defaultRouter;
export default function recordRoutes(req, res, next) {
  defaultRouter ||= createRecordRouter();
  return defaultRouter(req, res, next);
}
