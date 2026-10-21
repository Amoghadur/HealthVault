import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { createChallengeStore } from "../services/authChallenges.js";
import { createDoctorProfileStore } from "../services/doctorProfileStore.js";
import { createAuthRateLimiter } from "../middleware/rateLimiting.js";
import { getDataDir } from "../services/storagePaths.js";
dotenv.config();

// Patient/Doctor ID registry
export const patientRegistry = {};
export const walletToId = {};
export const idRoles = {};
let idCounter = 1001;

// ── Pre-register known wallets so HV IDs work immediately ──
export const KNOWN_WALLETS = {
  "0x38e602e8e54d9f73ed6b81a7437701b5ed78e4d1": { id: "HV-1001", role: "patient" },
  "0x89a34dfd2ee6f6c5714dbe7c391294fe87deb1c7": { id: "HV-1002", role: "doctor" }
};

Object.entries(KNOWN_WALLETS).forEach(([addr, info]) => {
  const address = addr.toLowerCase();
  patientRegistry[info.id] = address;
  walletToId[address] = info.id;
  idRoles[info.id] = info.role;
  const num = parseInt(info.id.split("-")[1], 10);
  if (num >= idCounter) idCounter = num + 1;
});

export function initPersistentProfiles(dataDir = getDataDir()) {
  try {
    const patientProfilesFile = path.join(dataDir, "patient_profiles.json");
    if (fs.existsSync(patientProfilesFile)) {
      const raw = fs.readFileSync(patientProfilesFile, "utf8");
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const p of items) {
          if (p?.walletAddress && ethers.isAddress(p.walletAddress)) {
            const addr = p.walletAddress.toLowerCase();
            if (!walletToId[addr]) {
              const id = `HV-${idCounter++}`;
              patientRegistry[id] = addr;
              walletToId[addr] = id;
              idRoles[id] = "patient";
            }
          }
        }
      }
    }
  } catch {
    // Ignore read errors on startup
  }

  try {
    const doctorProfilesFile = path.join(dataDir, "doctor_profiles.json");
    if (fs.existsSync(doctorProfilesFile)) {
      const raw = fs.readFileSync(doctorProfilesFile, "utf8");
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        for (const d of items) {
          if (d?.walletAddress && ethers.isAddress(d.walletAddress)) {
            const addr = d.walletAddress.toLowerCase();
            if (!walletToId[addr]) {
              const id = `HV-${idCounter++}`;
              patientRegistry[id] = addr;
              walletToId[addr] = id;
              idRoles[id] = "doctor";
            }
          }
        }
      }
    }
  } catch {
    // Ignore read errors on startup
  }
}

// Initialise from existing persistent files if present
initPersistentProfiles();

export function registerId(id, address, role = "patient") {
  const normId = id.toUpperCase().trim();
  const normAddr = address.toLowerCase().trim();
  patientRegistry[normId] = normAddr;
  walletToId[normAddr] = normId;
  idRoles[normId] = role;
  const num = parseInt(normId.split("-")[1], 10);
  if (Number.isFinite(num) && num >= idCounter) idCounter = num + 1;
}

export function getOrCreatePatientId(address, role = "patient") {
  const addr = address.toLowerCase();
  if (walletToId[addr]) {
    const existingId = walletToId[addr];
    if (role && (!idRoles[existingId] || role === "doctor")) {
      idRoles[existingId] = role;
    }
    return existingId;
  }
  const id = `HV-${idCounter++}`;
  patientRegistry[id] = addr;
  walletToId[addr] = id;
  idRoles[id] = role;
  return id;
}

export function createLookupRateLimiter({
  windowMs = 60 * 1000,
  max = 30,
  now = Date.now
} = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const currentTime = now();
    const key = req.user?.address || req.ip || req.connection?.remoteAddress || "anonymous";

    for (const [k, record] of hits) {
      if (record.resetAt <= currentTime) hits.delete(k);
    }

    let record = hits.get(key);
    if (!record || record.resetAt <= currentTime) {
      record = { count: 0, resetAt: currentTime + windowMs };
      hits.set(key, record);
    }

    record.count++;
    const remaining = Math.max(0, max - record.count);
    const retryAfter = Math.max(1, Math.ceil((record.resetAt - currentTime) / 1000));

    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(Math.ceil(record.resetAt / 1000)));

    if (record.count > max) {
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many patient lookup attempts. Please try again later.",
        retryAfter
      });
    }
    next();
  };
}

export function createAuthRouter({
  challenges = createChallengeStore({ origin: process.env.AUTH_ORIGIN || "http://localhost:5173" }),
  secret = process.env.JWT_SECRET,
  doctorProfiles = createDoctorProfileStore(),
  lookupRateLimiter = createLookupRateLimiter(),
  authRateLimiter = createAuthRateLimiter()
} = {}) {
  if (!secret || typeof secret !== "string" || secret.length < 32) {
    throw new Error("JWT secret is required and must be at least 32 characters long.");
  }
  const router = express.Router();
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required to perform patient lookup." });
    }
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, secret);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: "Session invalid or expired. Please sign in again." });
    }
  };

  // GET /auth/nonce/:address
  router.get("/nonce/:address", authRateLimiter, (req, res) => {
    if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: "A valid wallet address is required." });
    try {
      const challenge = challenges.issue(req.params.address);
      res.json({ ...challenge, patientId: getOrCreatePatientId(req.params.address) });
    } catch { res.status(429).json({ error: "Sign-in is busy. Try again shortly." }); }
  });

  router.post("/verify", authRateLimiter, (req, res) => {
    const { address, signature, role } = req.body;
    if (typeof address !== "string" || !ethers.isAddress(address) || typeof signature !== "string") return res.status(400).json({ error: "Valid address and signature required." });
    if (!secret) return res.status(503).json({ error: "Sign-in is not configured on this server." });
    let addr;
    try { addr = challenges.verifyAndConsume(address, signature); }
    catch (err) { return res.status(401).json({ error: err.message }); }
    const isDoctor = role === "doctor" || Boolean(doctorProfiles?.get?.(addr)) || KNOWN_WALLETS[addr]?.role === "doctor";
    const assignedRole = isDoctor ? "doctor" : "patient";
    const patientId = getOrCreatePatientId(addr, assignedRole);
    const token = jwt.sign({ address: addr, patientId, role: assignedRole }, secret, { expiresIn: "24h" });
    res.json({ success: true, token, address: addr, patientId, role: assignedRole });
  });

  // GET /auth/lookup/:patientId
  // Protected: requires valid JWT, enforces role restriction (doctor looks up patient, patient looks up doctor), rate limits
  router.get("/lookup/:patientId", authenticate, lookupRateLimiter, (req, res) => {
    const rawId = req.params.patientId || "";
    const id = rawId.toUpperCase().trim();

    if (!/^HV-\d+$/i.test(id)) {
      return res.status(400).json({
        error: "Invalid HealthVault ID format. Expected format: HV-1001."
      });
    }

    const address = patientRegistry[id];
    if (!address) {
      return res.status(404).json({
        error: `Patient ID ${id} not found. Ask patient for their HealthVault ID.`
      });
    }

    let callerRole = (req.user?.role || "").toLowerCase();
    const callerAddr = req.user?.address ? req.user.address.toLowerCase() : "";
    if (callerAddr) {
      if (doctorProfiles?.get?.(callerAddr) || KNOWN_WALLETS[callerAddr]?.role === "doctor") {
        callerRole = "doctor";
      } else if (!callerRole) {
        const id = walletToId[callerAddr] || req.user.patientId;
        if (id && idRoles[id]) {
          callerRole = idRoles[id].toLowerCase();
        }
      }
    }
    const targetRole = (idRoles[id] || (doctorProfiles?.get?.(address) ? "doctor" : "patient")).toLowerCase();

    if (callerRole === "doctor" && targetRole !== "patient") {
      return res.status(403).json({ error: "Access denied. Doctors may only look up patient IDs." });
    }
    if (callerRole === "patient" && targetRole !== "doctor") {
      return res.status(403).json({ error: "Access denied. Patients may only look up doctor IDs." });
    }
    if (callerRole !== "doctor" && callerRole !== "patient") {
      return res.status(403).json({ error: "Access denied. Valid user role (doctor or patient) required." });
    }

    console.log(`Lookup: ${id} (${targetRole}) → ${address} (by ${callerRole} ${req.user.address})`);
    res.json({ patientId: id, address });
  });

  // GET /auth/myid
  router.get("/myid", (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Not logged in" });
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, secret);
      const isDoctor = decoded.role === "doctor" || Boolean(doctorProfiles?.get?.(decoded.address)) || KNOWN_WALLETS[decoded.address]?.role === "doctor";
      const id = getOrCreatePatientId(decoded.address, isDoctor ? "doctor" : "patient");
      res.json({ patientId: id, address: decoded.address });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  return router;
}

let defaultRouter = null;
export default function authRoutes(req, res, next) {
  if (!defaultRouter) {
    defaultRouter = createAuthRouter();
  }
  return defaultRouter(req, res, next);
}
