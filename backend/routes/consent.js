import express from "express";
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import crypto from "crypto";
import { requireAuth } from "../middleware/authMiddleware.js";
import dotenv from "dotenv";
import { recordActivity } from "../services/auditStore.js";
import { createDoctorProfileStore } from "../services/doctorProfileStore.js";
import { defaultExpiryStore } from "../services/consentExpiryStore.js";
import { defaultEmergencyTokenStore } from "../services/emergencyTokenStore.js";
import { defaultConsentRequestStore } from "../services/consentRequestStore.js";
import { defaultConsentAllowListStore } from "../services/consentAllowListStore.js";
import { readCurrentAccess } from "../services/blockchain.js";
import { defaultPatientProfileStore } from "../services/patientProfileStore.js";
import { validateEmergencyQrBaseUrl, buildEmergencyScanUrl, getEmergencyQrConfig } from "../services/emergencyQrUrl.js";
import { createConsentRateLimiter, createEmergencyQrRateLimiter, createEmergencyScanRateLimiter } from "../middleware/rateLimiting.js";
dotenv.config();


export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeArrayOrString(value, fallback = "") {
  if (Array.isArray(value)) {
    const items = value
      .map(item => escapeHtml(item).trim())
      .filter(Boolean);
    return items.length > 0 ? items.join(", ") : fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    return escapeHtml(value.trim());
  }
  return fallback;
}

export function createConsentRouter({
  profiles = createDoctorProfileStore(),
  audit = recordActivity,
  expiryStore = defaultExpiryStore,
  emergencyStore = defaultEmergencyTokenStore,
  requestStore = defaultConsentRequestStore,
  allowListStore = defaultConsentAllowListStore,
  hasAccess = readCurrentAccess,
  recordsFilePath = path.join("uploads", "records_metadata.json"),
  consentRateLimiter = createConsentRateLimiter(),
  patientProfiles = defaultPatientProfileStore,
  emergencyQrBaseUrl = process.env.EMERGENCY_QR_BASE_URL,
  emergencyQrRateLimiter = createEmergencyQrRateLimiter(),
  emergencyScanRateLimiter = createEmergencyScanRateLimiter()
} = {}) {
const router = express.Router();


function getPatientRecordIds(patientAddress, doctorAddress) {
  try {
    if (!fs.existsSync(recordsFilePath)) return new Set();
    const records = JSON.parse(fs.readFileSync(recordsFilePath, "utf8"));
    if (!Array.isArray(records)) return new Set();
    const target = patientAddress ? patientAddress.toLowerCase() : "";
    const targetDoc = doctorAddress ? doctorAddress.toLowerCase() : null;
    const ids = records
      .filter(r => {
        if (!r.patientAddress || r.patientAddress.toLowerCase() !== target) return false;
        // Doctor-uploaded records are not the patient's to share with that doctor
        if (targetDoc && r.doctorAddress && r.doctorAddress.toLowerCase() === targetDoc) return false;
        return true;
      })
      .map(r => String(r.id));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function withProfile(request) {
  let profile = null;
  let profileUnavailable = false;
  try { profile = profiles.get(request.doctorAddress); }
  catch { profileUnavailable = true; }
  return { ...request, doctorName: profile?.displayName || `Wallet ${request.doctorAddress}`, profile, profileUnavailable };
}

function withPatientProfile(request) {
  let profile = null;
  try { profile = patientProfiles?.get(request.patientAddress); }
  catch {}
  const shortAddr = request.patientAddress ? `${request.patientAddress.slice(0, 8)}...${request.patientAddress.slice(-4)}` : '';
  return {
    ...request,
    patientName: profile?.displayName || `Patient ${shortAddr}`,
    patientAvatar: profile?.avatar || null
  };
}

function withAuthorizationState(request) {
  if (!request) return request;
  const now = Date.now();
  let authStatus = request.status || "pending";

  if (request.status === "pending") {
    if (request.expiresAt && Date.parse(request.expiresAt) <= now) {
      authStatus = "expired";
    } else {
      authStatus = "pending";
    }
  } else if (request.status === "accepted" || request.status === "approved") {
    const grant = expiryStore?.get?.(request.patientAddress, request.doctorAddress);
    if (grant) {
      if (grant.revokedAt) {
        authStatus = "revoked";
      } else if (Date.parse(grant.expiresAt) <= now) {
        authStatus = "expired";
      } else {
        authStatus = "approved";
      }
    } else {
      authStatus = "expired";
    }
  } else if (request.status === "rejected") {
    authStatus = "rejected";
  } else if (request.status === "revoked") {
    authStatus = "revoked";
  } else if (request.status === "expired") {
    authStatus = "expired";
  }

  return {
    ...request,
    authorizationStatus: authStatus
  };
}

const CONTRACT_ABI = [
  "function grantAccess(address doctor) public",
  "function revokeAccess(address doctor) public",
  "function hasAccess(address patient, address doctor) public view returns (bool)"
];

// ─────────────────────────────────────────
// POST /consent/request
// Doctor sends an access request to patient
// ─────────────────────────────────────────
router.post("/request", consentRateLimiter, requireAuth, (req, res) => {
  const { patientAddress, reason } = req.body;

  if (!patientAddress) {
    return res.status(400).json({ error: "Patient wallet address required" });
  }

  if (req.user?.role && req.user.role !== "doctor") {
    return res.status(403).json({ error: "Only doctors can request patient access." });
  }

  // Always use lowercase for storage
  const patientAddr = patientAddress.toLowerCase();
  const doctorAddr = req.user.address.toLowerCase();

  let result;
  try {
    result = requestStore.createRequest({
      patientAddress: patientAddr,
      doctorAddress: doctorAddr,
      reason: reason || "Medical consultation"
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!result.created) {
    return res.json({
      success: true,
      message: "Request already sent",
      request: withAuthorizationState(withProfile(result.request))
    });
  }

  audit({ action: "AccessRequested", actor: doctorAddr, patient: patientAddr, doctor: doctorAddr });

  console.log(`Access request from ${doctorAddr} for patient ${patientAddr}`);
  res.json({ success: true, message: "Request sent to patient", request: withAuthorizationState(withProfile(result.request)) });
});

// ─────────────────────────────────────────
// GET /consent/requests
// Patient fetches pending incoming requests, or doctor fetches pending outgoing requests
// ─────────────────────────────────────────
router.get("/requests", requireAuth, (req, res) => {
  const addr = req.user.address.toLowerCase();
  const callerRole = (req.user.role || "").toLowerCase();
  const queryType = req.query.type; // "incoming" or "outgoing"

  res.set("Cache-Control", "no-store");

  const isOutgoing = queryType === "outgoing" || (callerRole === "doctor" && queryType !== "incoming");

  if (isOutgoing) {
    let requests = [];
    try {
      const patientFilter = req.query.patientAddress ? req.query.patientAddress.toLowerCase() : null;
      const statusFilter = req.query.status ? req.query.status.toLowerCase() : null;
      let doctorRequests = [];
      if (statusFilter === "pending") {
        doctorRequests = requestStore.getPendingForDoctor
          ? requestStore.getPendingForDoctor(addr)
          : (requestStore.getAll() || []).filter(r => r.doctorAddress === addr && r.status === 'pending');
      } else if (requestStore.getRequestsForDoctor) {
        doctorRequests = requestStore.getRequestsForDoctor(addr);
      } else if (requestStore.getPendingForDoctor) {
        doctorRequests = requestStore.getPendingForDoctor(addr);
      } else {
        doctorRequests = (requestStore.getAll() || []).filter(r => r.doctorAddress === addr);
      }
      if (patientFilter) {
        doctorRequests = doctorRequests.filter(r => r.patientAddress === patientFilter);
      }
      requests = doctorRequests.map(r => withAuthorizationState(withProfile(withPatientProfile(r))));
    } catch {
      requests = [];
    }
    console.log(`Fetching outgoing requests for doctor ${addr} — found ${requests.length}`);
    return res.json({ requests, total: requests.length, type: "outgoing" });
  }

  // Incoming requests for patient
  let pending = [];
  try {
    pending = requestStore.getPendingForPatient(addr).map(r => withAuthorizationState(withProfile(withPatientProfile(r))));
  } catch {
    pending = [];
  }
  console.log(`Fetching requests for ${addr} — found ${pending.length} pending`);
  res.json({ requests: pending, total: pending.length, type: "incoming" });
});

// Explicit route for doctor outgoing requests
router.get("/requests/outgoing", requireAuth, (req, res) => {
  const addr = req.user.address.toLowerCase();
  res.set("Cache-Control", "no-store");
  let requests = [];
  try {
    const patientFilter = req.query.patientAddress ? req.query.patientAddress.toLowerCase() : null;
    const statusFilter = req.query.status ? req.query.status.toLowerCase() : null;
    let doctorRequests = [];
    if (statusFilter === "pending") {
      doctorRequests = requestStore.getPendingForDoctor
        ? requestStore.getPendingForDoctor(addr)
        : (requestStore.getAll() || []).filter(r => r.doctorAddress === addr && r.status === 'pending');
    } else if (requestStore.getRequestsForDoctor) {
      doctorRequests = requestStore.getRequestsForDoctor(addr);
    } else if (requestStore.getPendingForDoctor) {
      doctorRequests = requestStore.getPendingForDoctor(addr);
    } else {
      doctorRequests = (requestStore.getAll() || []).filter(r => r.doctorAddress === addr);
    }
    if (patientFilter) {
      doctorRequests = doctorRequests.filter(r => r.patientAddress === patientFilter);
    }
    requests = doctorRequests.map(r => withAuthorizationState(withProfile(withPatientProfile(r))));
  } catch {
    requests = [];
  }
  res.json({ requests, total: requests.length, type: "outgoing" });
});

// Explicit route for patient incoming requests
router.get("/requests/incoming", requireAuth, (req, res) => {
  const addr = req.user.address.toLowerCase();
  res.set("Cache-Control", "no-store");
  let pending = [];
  try {
    pending = requestStore.getPendingForPatient(addr).map(r => withAuthorizationState(withProfile(withPatientProfile(r))));
  } catch {
    pending = [];
  }
  res.json({ requests: pending, total: pending.length, type: "incoming" });
});

// ─────────────────────────────────────────
// POST /consent/respond
// Patient accepts or rejects a request
// ─────────────────────────────────────────
router.post("/respond", consentRateLimiter, requireAuth, (req, res) => {
  const { requestId, action, durationMinutes = 15, recordIds = [] } = req.body;
  const patientAddr = req.user.address.toLowerCase();

  const request = requestStore.findById(requestId);
  if (!request || request.patientAddress !== patientAddr) {
    return res.status(404).json({ error: "Request not found" });
  }

  if (Date.parse(request.expiresAt) <= Date.now()) {
    return res.status(410).json({ error: "Request has expired" });
  }

  let grant = null;
  let savedAllowList = [];
  if (action === "accept") {
    try {
      grant = expiryStore?.saveGrant({
        patientAddress: patientAddr,
        doctorAddress: request.doctorAddress,
        durationMinutes
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (allowListStore) {
      const validRecordIds = getPatientRecordIds(patientAddr, request.doctorAddress);
      const entry = allowListStore.setAllowList({
        patientAddress: patientAddr,
        doctorAddress: request.doctorAddress,
        recordIds: Array.isArray(recordIds) ? recordIds : [],
        validPatientRecordIds: validRecordIds
      });
      savedAllowList = entry.recordIds;
    }
  } else {
    expiryStore?.revoke(patientAddr, request.doctorAddress);
    allowListStore?.removeAllowList(patientAddr, request.doctorAddress);
  }

  try {
    requestStore.respond({ requestId, patientAddress: patientAddr, action });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  audit({
    action: action === "accept" ? "RequestAccepted" : "RequestRejected",
    actor: patientAddr,
    patient: patientAddr,
    doctor: request.doctorAddress,
    sharedRecordCount: action === "accept" ? savedAllowList.length : 0
  });

  console.log(`Patient ${patientAddr} ${action}ed request from ${request.doctorAddress} (shared ${savedAllowList.length} records)`);

  res.json({
    success: true,
    action,
    doctorAddress: request.doctorAddress,
    grant,
    recordIds: savedAllowList,
    message: action === "accept"
      ? "Accepted. Blockchain grant should be called from frontend."
      : "Request rejected."
  });
});

// ─────────────────────────────────────────
// POST /consent/grant
// Patient directly grants access with duration & selected records
// ─────────────────────────────────────────
router.post("/grant", consentRateLimiter, requireAuth, (req, res) => {
  const { doctorAddress, durationMinutes, recordIds = [] } = req.body;
  if (!doctorAddress) return res.status(400).json({ error: "Doctor address required" });
  const patientAddr = req.user.address.toLowerCase();
  let grant;
  try {
    grant = expiryStore.saveGrant({
      patientAddress: patientAddr,
      doctorAddress,
      durationMinutes
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let savedAllowList = [];
  if (allowListStore) {
    const validRecordIds = getPatientRecordIds(patientAddr, grant.doctorAddress);
    const entry = allowListStore.setAllowList({
      patientAddress: patientAddr,
      doctorAddress: grant.doctorAddress,
      recordIds: Array.isArray(recordIds) ? recordIds : [],
      validPatientRecordIds: validRecordIds
    });
    savedAllowList = entry.recordIds;
  }

  audit({
    action: "AccessGranted",
    actor: patientAddr,
    patient: patientAddr,
    doctor: grant.doctorAddress,
    sharedRecordCount: savedAllowList.length
  });
  res.json({ success: true, grant, recordIds: savedAllowList });
});

// ─────────────────────────────────────────
// POST /consent/revoke
// Patient directly revokes access
// ─────────────────────────────────────────
router.post("/revoke", consentRateLimiter, requireAuth, (req, res) => {
  const { doctorAddress } = req.body;
  if (!doctorAddress) return res.status(400).json({ error: "Doctor address required" });
  const patientAddr = req.user.address.toLowerCase();
  expiryStore.revoke(patientAddr, doctorAddress);
  allowListStore?.removeAllowList(patientAddr, doctorAddress);
  audit({ action: "AccessRevoked", actor: patientAddr, patient: patientAddr, doctor: doctorAddress.toLowerCase() });
  res.json({ success: true, message: "Access revoked" });
});

// ─────────────────────────────────────────
// GET /consent/grants
// Patient lists their active and past grants
// ─────────────────────────────────────────
router.get("/grants", requireAuth, (req, res) => {
  const patientAddr = req.user.address.toLowerCase();
  res.set("Cache-Control", "no-store");
  const grants = (expiryStore?.listByPatient(patientAddr) || []).map(grant => {
    let profile = null;
    try { profile = profiles.get(grant.doctorAddress); } catch {}
    const now = Date.now();
    const isExpired = Date.parse(grant.expiresAt) <= now;
    const isRevoked = !!grant.revokedAt;
    const status = isRevoked ? "revoked" : (isExpired ? "expired" : "active");
    const remainingSeconds = isRevoked || isExpired ? 0 : Math.max(0, Math.round((Date.parse(grant.expiresAt) - now) / 1000));
    const validRecordIds = getPatientRecordIds(patientAddr, grant.doctorAddress);
    const allowList = (allowListStore?.getAllowList(patientAddr, grant.doctorAddress) || [])
      .filter(id => validRecordIds.has(id));
    return {
      ...grant,
      doctorName: profile?.displayName || `Wallet ${grant.doctorAddress}`,
      profile,
      status,
      remainingSeconds,
      sharedRecordIds: allowList,
      sharedRecordCount: allowList.length
    };
  });
  res.json({ grants });
});

// ─────────────────────────────────────────
// GET /consent/allowlist/:doctorAddress
// Patient reads the current allow-list for a doctor
// ─────────────────────────────────────────
router.get("/allowlist/:doctorAddress", consentRateLimiter, requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  const { doctorAddress } = req.params;
  if (!doctorAddress || typeof doctorAddress !== "string" || !ethers.isAddress(doctorAddress)) {
    return res.status(400).json({ error: "Valid doctor address required" });
  }
  const patientAddr = req.user.address.toLowerCase();
  const docAddr = doctorAddress.toLowerCase();
  const validRecordIds = getPatientRecordIds(patientAddr, docAddr);
  const rawList = allowListStore?.getAllowList(patientAddr, docAddr) || [];
  const allowList = rawList.filter(id => validRecordIds.has(id));
  const activeGrant = expiryStore?.getActiveGrant(patientAddr, docAddr);
  res.json({
    patientAddress: patientAddr,
    doctorAddress: docAddr,
    recordIds: allowList,
    hasActiveGrant: !!activeGrant
  });
});

// ─────────────────────────────────────────
// PUT /consent/allowlist/:doctorAddress
// Patient updates the allow-list of an existing active grant
// ─────────────────────────────────────────
router.put("/allowlist/:doctorAddress", consentRateLimiter, requireAuth, (req, res) => {
  const { doctorAddress } = req.params;
  if (!doctorAddress || typeof doctorAddress !== "string" || !ethers.isAddress(doctorAddress)) {
    return res.status(400).json({ error: "Valid doctor address required" });
  }
  const patientAddr = req.user.address.toLowerCase();
  const docAddr = doctorAddress.toLowerCase();

  // Validate active grant exists
  const activeGrant = expiryStore?.getActiveGrant(patientAddr, docAddr);
  if (!activeGrant) {
    return res.status(404).json({ error: "No active consent grant found for this doctor." });
  }

  const { recordIds } = req.body;
  if (!Array.isArray(recordIds)) {
    return res.status(400).json({ error: "recordIds must be an array of record IDs." });
  }

  if (!allowListStore) {
    return res.status(503).json({ error: "Allow-list storage unavailable." });
  }

  const validRecordIds = getPatientRecordIds(patientAddr, docAddr);
  const entry = allowListStore.setAllowList({
    patientAddress: patientAddr,
    doctorAddress: docAddr,
    recordIds,
    validPatientRecordIds: validRecordIds
  });

  audit({
    action: "ConsentAllowListUpdated",
    actor: patientAddr,
    patient: patientAddr,
    doctor: docAddr,
    recordCount: entry.recordIds.length
  });

  console.log(`Patient ${patientAddr} updated allow-list for doctor ${docAddr} (${entry.recordIds.length} records)`);
  res.json({
    success: true,
    patientAddress: patientAddr,
    doctorAddress: docAddr,
    recordIds: entry.recordIds,
    updatedAt: entry.updatedAt
  });
});

// ─────────────────────────────────────────
// GET /consent/status/:doctorAddress
// Check if a doctor has access to patient
// ─────────────────────────────────────────
router.get("/status/:doctorAddress", requireAuth, async (req, res) => {
  const { doctorAddress } = req.params;
  const caller = req.user.address.toLowerCase();
  const patientAddr = req.query.patientAddress ? req.query.patientAddress.toLowerCase() : caller;
  const doctorAddr = req.query.patientAddress ? caller : doctorAddress.toLowerCase();

  const grant = expiryStore?.getActiveGrant(patientAddr, doctorAddr);
  const storedGrant = expiryStore?.get(patientAddr, doctorAddr);

  try {
    const onChainAccess = await hasAccess(patientAddr, doctorAddr);
    if (!onChainAccess && storedGrant && !storedGrant.revokedAt) {
      expiryStore?.revoke(patientAddr, doctorAddr);
    }
    const effectiveAccess = Boolean(grant && onChainAccess);
    const now = Date.now();
    let status = "none";
    if (!onChainAccess && storedGrant) status = "revoked";
    else if (!onChainAccess) status = "revoked";
    else if (grant && onChainAccess) status = "active";
    else if (storedGrant && Date.parse(storedGrant.expiresAt) <= now) status = "expired";
    else if (storedGrant?.revokedAt) status = "revoked";
    else status = "none";

    res.json({
      hasAccess: effectiveAccess,
      onChainAccess,
      status,
      patientAddress: patientAddr,
      doctorAddress: doctorAddr,
      expiresAt: grant?.expiresAt || storedGrant?.expiresAt,
      remainingSeconds: grant ? Math.max(0, Math.round((Date.parse(grant.expiresAt) - now) / 1000)) : 0
    });
  } catch (err) {
    res.status(503).json({ error: "Could not verify consent on Sepolia: " + err.message, status: "verification-unavailable" });
  }
});

// ─────────────────────────────────────────
// GET /consent/qr/config
// Public endpoint reporting whether public cross-device QR scanning is configured
// ─────────────────────────────────────────
router.get("/qr/config", (req, res) => {
  const config = getEmergencyQrConfig(emergencyQrBaseUrl);
  res.json(config);
});

// ─────────────────────────────────────────
// GET /consent/qr/active
// Patient fetches their current active emergency QR code
// ─────────────────────────────────────────
router.get("/qr/active", requireAuth, (req, res) => {
  const activeRecord = emergencyStore.getActiveForPatient(req.user.address);
  const config = getEmergencyQrConfig(emergencyQrBaseUrl);

  if (!activeRecord) {
    return res.json({
      hasActive: false,
      configured: config.configured,
      publicHost: config.host
    });
  }

  let scanUrl = null;
  if (config.configured) {
    try {
      scanUrl = buildEmergencyScanUrl(emergencyQrBaseUrl, activeRecord.token);
    } catch {
      scanUrl = null;
    }
  }

  res.json({
    hasActive: true,
    token: activeRecord.token,
    expiry: activeRecord.expiry,
    expiresAt: activeRecord.expiresAt,
    expiryTime: new Date(activeRecord.expiry).toLocaleTimeString(),
    scanUrl,
    configured: config.configured,
    publicHost: config.host,
    data: activeRecord.data
  });
});

// ─────────────────────────────────────────
// POST /consent/qr/generate
// Patient generates emergency QR token
// ─────────────────────────────────────────
router.post("/qr/generate", requireAuth, emergencyQrRateLimiter, (req, res) => {
  // Validate that EMERGENCY_QR_BASE_URL is configured as a public HTTPS endpoint.
  // Never silently fall back to localhost or private development IPs for cross-device QR.
  const validation = validateEmergencyQrBaseUrl(emergencyQrBaseUrl);
  if (!validation.valid) {
    return res.status(503).json({
      success: false,
      error: "Public Emergency QR endpoint is not configured. Set EMERGENCY_QR_BASE_URL to an absolute public HTTPS URL (e.g. Cloudflare Tunnel or public HTTPS domain). Localhost and private LAN addresses are rejected for cross-device emergency QR codes.",
      code: "EMERGENCY_QR_BASE_URL_NOT_CONFIGURED",
      details: validation.error
    });
  }

  const { patientData } = req.body;
  const raw = patientData && typeof patientData === "object" ? patientData : {};

  // Strictly sanitize allowed emergency profile fields
  const clinicalData = {
    name: typeof raw.name === "string" ? raw.name.slice(0, 200).trim() : null,
    age: raw.age ? String(raw.age).slice(0, 20).trim() : null,
    bloodType: typeof raw.bloodType === "string" && raw.bloodType.trim() ? raw.bloodType.slice(0, 100).trim() : "O+",
    allergies: Array.isArray(raw.allergies)
      ? raw.allergies.map(a => String(a).slice(0, 200).trim()).filter(Boolean)
      : (typeof raw.allergies === "string" && raw.allergies.trim() ? raw.allergies.split(",").map(a => a.trim()).filter(Boolean) : ["None known"]),
    medications: Array.isArray(raw.medications)
      ? raw.medications.map(m => String(m).slice(0, 200).trim()).filter(Boolean)
      : (typeof raw.medications === "string" && raw.medications.trim() ? raw.medications.split(",").map(m => m.trim()).filter(Boolean) : ["None"]),
    conditions: Array.isArray(raw.conditions)
      ? raw.conditions.map(c => String(c).slice(0, 200).trim()).filter(Boolean)
      : (typeof raw.conditions === "string" && raw.conditions.trim() ? raw.conditions.split(",").map(c => c.trim()).filter(Boolean) : []),
    emergencyContact: typeof raw.emergencyContact === "string" && raw.emergencyContact.trim()
      ? raw.emergencyContact.slice(0, 200).trim()
      : "Not provided"
  };

  const token = crypto.randomBytes(32).toString("hex");
  const expiry = Date.now() + 60 * 60 * 1000;

  // Build clean, cross-device scan URL
  const scanUrl = buildEmergencyScanUrl(emergencyQrBaseUrl, token);

  emergencyStore.saveToken({
    token,
    patientAddress: req.user.address,
    expiry,
    data: clinicalData
  });

  console.log(`Emergency QR generated for ${req.user.address}`);
  audit({ action: "EmergencyCreated", actor: req.user.address, patient: req.user.address });

  res.json({
    success: true,
    token,
    expiry,
    expiryTime: new Date(expiry).toLocaleTimeString(),
    scanUrl,
    publicHost: validation.parsed.host
  });
});

// ─────────────────────────────────────────
// POST /consent/qr/revoke
// Patient revokes their active emergency QR code
// ─────────────────────────────────────────
router.post("/qr/revoke", requireAuth, emergencyQrRateLimiter, (req, res) => {
  const { token } = req.body || {};
  let revokedCount = 0;

  if (token && typeof token === "string" && /^[a-f0-9]{64}$/i.test(token.trim())) {
    const success = emergencyStore.revokeToken(token.trim(), req.user.address);
    revokedCount = success ? 1 : 0;
  } else {
    revokedCount = emergencyStore.revokePatientTokens(req.user.address);
  }

  audit({ action: "EmergencyRevoked", actor: req.user.address, patient: req.user.address });

  res.json({
    success: true,
    message: "Emergency QR code revoked successfully.",
    revokedCount
  });
});

// ─────────────────────────────────────────
// GET /consent/qr/scan/:token
// Anyone who scans the QR hits this route
// ─────────────────────────────────────────
router.get("/qr/scan/:token", emergencyScanRateLimiter, (req, res) => {
  const rawToken = (req.params.token || "").trim();
  const isJson = req.query?.format === "json" || (req.headers.accept && req.headers.accept.includes("application/json"));

  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

  // Basic sanity check: reject empty or outrageously large token strings
  if (!rawToken || rawToken.length > 128) {
    if (isJson) {
      return res.status(400).json({ error: "Malformed emergency token." });
    }
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="referrer" content="no-referrer">
          <title>Invalid QR Code — HealthVault</title>
        </head>
        <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff0f0">
          <h2 style="color:#E53935">❌ Malformed Emergency QR Code</h2>
          <p>The scanned emergency token is invalid or malformed.</p>
        </body>
      </html>
    `);
  }

  const record = emergencyStore.get(rawToken);

  if (!record) {
    // If not found in store, verify if it was a malformed format (invalid characters or too short)
    if (rawToken.length < 12 || !/^[a-zA-Z0-9_-]+$/.test(rawToken)) {
      if (isJson) {
        return res.status(400).json({ error: "Malformed emergency token. Must be a valid alphanumeric token string." });
      }
      res.set("Content-Type", "text/html; charset=utf-8");
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="referrer" content="no-referrer">
            <title>Invalid QR Code — HealthVault</title>
          </head>
          <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff0f0">
            <h2 style="color:#E53935">❌ Malformed Emergency QR Code</h2>
            <p>The scanned emergency token is invalid or malformed.</p>
          </body>
        </html>
      `);
    }

    if (isJson) {
      return res.status(404).json({ error: "This QR code does not exist or has already expired." });
    }
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="referrer" content="no-referrer">
          <title>Invalid QR Code — HealthVault</title>
        </head>
        <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff0f0">
          <h2 style="color:#E53935">❌ Invalid QR Code</h2>
          <p>This QR code does not exist or has already expired.</p>
        </body>
      </html>
    `);
  }


  if (record.revoked) {
    if (isJson) {
      return res.status(410).json({ error: "This emergency QR code has been revoked by the patient." });
    }
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(410).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="referrer" content="no-referrer">
          <title>QR Code Revoked — HealthVault</title>
        </head>
        <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff0f0">
          <h2 style="color:#E53935">⊘ QR Code Revoked</h2>
          <p>This emergency QR code was revoked by the patient and is no longer valid.</p>
        </body>
      </html>
    `);
  }

  if (Date.now() > record.expiry) {
    if (isJson) {
      return res.status(410).json({ error: "This emergency QR has expired. Ask the patient to generate a new one." });
    }
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(410).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="referrer" content="no-referrer">
          <title>QR Code Expired — HealthVault</title>
        </head>
        <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff0f0">
          <h2 style="color:#E53935">⏱ QR Code Expired</h2>
          <p>This emergency QR has expired. Ask the patient to generate a new one.</p>
        </body>
      </html>
    `);
  }

  const { data } = record;
  res.once("finish", () => {
    if (res.statusCode === 200) audit({ action: "EmergencyServed", patient: record.patientAddress, outcome: "response-sent" });
  });

  const bloodType = escapeHtml(data.bloodType) || "Not recorded";
  const allergies = escapeArrayOrString(data.allergies, "None known");
  const medications = escapeArrayOrString(data.medications, "None");
  const conditions = escapeArrayOrString(data.conditions, "None");
  const emergencyContact = escapeHtml(data.emergencyContact) || "Not provided";
  const expiryFormatted = escapeHtml(new Date(record.expiry).toLocaleTimeString());
  const patientName = data.name ? escapeHtml(data.name) : null;
  const patientAge = data.age ? escapeHtml(data.age) : null;

  if (isJson) {
    return res.json({
      success: true,
      bloodType,
      allergies,
      medications,
      conditions,
      emergencyContact,
      patientName,
      patientAge,
      expiresAt: record.expiresAt,
      expiry: record.expiry
    });
  }

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="referrer" content="no-referrer">
        <title>HealthVault Emergency Access</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #f0faf5; min-height: 100vh; padding: 24px 16px; color: #1e293b; }
          .card { background: white; border-radius: 16px; padding: 24px; max-width: 460px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
          .badge { background: #E53935; color: white; padding: 6px 16px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-block; margin-bottom: 12px; letter-spacing: 0.05em; }
          h1 { font-size: 22px; color: #0f172a; margin-bottom: 4px; text-align: center; font-weight: 700; }
          .subtitle { font-size: 12px; color: #64748b; text-align: center; margin-bottom: 16px; }
          .disclaimer { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; font-size: 11px; color: #1e40af; line-height: 1.5; margin-bottom: 16px; text-align: left; }
          .expiry { background: #FFF3E0; border: 1px solid #FFE0B2; border-radius: 8px; padding: 10px; text-align: center; font-size: 12px; color: #E65100; margin-bottom: 16px; font-weight: 600; }
          .field { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
          .field-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.04em; }
          .field-value { font-size: 15px; font-weight: 600; color: #0f172a; word-break: break-word; }
          .allergy { background: #FFEBEE; border: 1px solid #EF9A9A; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
          .allergy .field-label { color: #E53935; }
          .allergy .field-value { color: #C62828; }
          .footer { text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8; line-height: 1.8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="text-align:center;margin-bottom:12px">
            <div class="badge">🚨 EMERGENCY ACCESS ONLY</div>
            <h1>HealthVault</h1>
            <p class="subtitle">Critical patient information — emergency responder view</p>
          </div>
          <div class="disclaimer">
            <strong>⚠️ Emergency Protocol:</strong> This page displays self-reported critical health data. QR possession does not verify physician credentials or authorize clinical record access.
          </div>
          <div class="expiry">
            ⏱ This emergency page expires at ${expiryFormatted}
          </div>
          ${patientName ? `
          <div class="field">
            <div class="field-label">👤 Patient</div>
            <div class="field-value">${patientName}${patientAge ? ` (${patientAge} yrs)` : ''}</div>
          </div>` : ''}
          <div class="field">
            <div class="field-label">🩸 Blood Type</div>
            <div class="field-value">${bloodType}</div>
          </div>
          <div class="allergy">
            <div class="field-label">⚠️ Allergies</div>
            <div class="field-value">${allergies}</div>
          </div>
          <div class="field">
            <div class="field-label">💊 Current Medications</div>
            <div class="field-value">${medications}</div>
          </div>
          ${conditions && conditions !== 'None' ? `
          <div class="field">
            <div class="field-label">📋 Known Conditions</div>
            <div class="field-value">${conditions}</div>
          </div>` : ''}
          <div class="field">
            <div class="field-label">📞 Emergency Contact</div>
            <div class="field-value">${emergencyContact}</div>
          </div>
          <div class="footer">
            Powered by HealthVault Blockchain Security<br/>
            Time-limited emergency access only. Auto-expires.
          </div>
        </div>
      </body>
    </html>
  `);
});


return router;
}
export default createConsentRouter();
