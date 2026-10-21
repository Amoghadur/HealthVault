import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServerApp } from "../server.js";
import {
  createAuthRateLimiter,
  createRecordUploadRateLimiter,
  createConsentRateLimiter,
  createPatientProfileRateLimiter
} from "../middleware/rateLimiting.js";
import { createAuthRouter } from "../routes/auth.js";
import { createConsentRouter } from "../routes/consent.js";
import { createConsentRequestStore } from "../services/consentRequestStore.js";
import { createPatientRouter } from "../routes/patient.js";
import { createRecordRouter } from "../routes/records.js";

import { MemoryStore } from "express-rate-limit";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-hardening-at-least-32-chars";

// ── 1. Oversized body gets 413 ──
test("request limits: oversized JSON body (>1mb) is rejected with 413", async (t) => {
  const app = createServerApp({
    extraRoutes: (testApp) => {
      testApp.post("/test-limit", (req, res) => res.json({ ok: true }));
    }
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  // Payload > 1MB
  const largeString = "a".repeat(1.2 * 1024 * 1024); // 1.2 MB
  const payload = JSON.stringify({ data: largeString });

  const res = await fetch(`${base}/test-limit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });

  assert.equal(res.status, 413, "Oversized request body must return 413 Payload Too Large");
  const data = await res.json();
  assert.match(data.error, /Payload too large/i);
});

// ── 2. Disallowed origin gets no CORS headers ──
test("CORS: allowed origin receives CORS header; disallowed origin receives no CORS header", async (t) => {
  const app = createServerApp({ allowedOriginsEnv: "http://localhost:5173,https://healthvault.app" });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  // A. Disallowed origin
  const disallowedRes = await fetch(`${base}/`, {
    headers: { Origin: "http://malicious-website.com" }
  });
  assert.equal(
    disallowedRes.headers.get("access-control-allow-origin"),
    null,
    "Disallowed origin must receive NO Access-Control-Allow-Origin header"
  );

  // B. Allowed origin 1
  const allowedRes1 = await fetch(`${base}/`, {
    headers: { Origin: "http://localhost:5173" }
  });
  assert.equal(
    allowedRes1.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
    "Allowed origin must receive Access-Control-Allow-Origin header"
  );

  // C. Allowed origin 2
  const allowedRes2 = await fetch(`${base}/`, {
    headers: { Origin: "https://healthvault.app" }
  });
  assert.equal(
    allowedRes2.headers.get("access-control-allow-origin"),
    "https://healthvault.app"
  );
});

// ── 3. Central error handler: never leak stack traces, file paths, or raw internal details ──
test("central error handler: returns 500 without stack trace, file path, or raw library errors", async (t) => {
  const app = createServerApp({
    extraRoutes: (testApp) => {
      testApp.get("/test-error", (req, res, next) => {
        const error = new Error("Connection failed: /var/secrets/keys.pem at C:\\server\\db.js:42");
        error.stack = "Error: Connection failed\n    at Object.<anonymous> (C:\\server\\db.js:42:15)";
        next(error);
      });
    }
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/test-error`);
  assert.equal(res.status, 500);

  const body = await res.json();
  const rawBody = JSON.stringify(body);

  // Must not have stack trace
  assert.equal(body.stack, undefined, "Response must not contain stack property");
  assert.ok(!rawBody.includes("at Object.<anonymous>"), "Response must not contain stack trace");

  // Must not have file paths
  assert.ok(!rawBody.includes("C:\\server\\db.js"), "Response must not leak Windows internal paths");
  assert.ok(!rawBody.includes("/var/secrets/keys.pem"), "Response must not leak Linux internal paths");

  // Must be generic error message
  assert.equal(body.error, "An internal server error occurred.");
});

// ── 4. Security headers (Helmet) ──
test("security headers: helmet sets nosniff and other defense-in-depth headers", async (t) => {
  const app = createServerApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-dns-prefetch-control"), "off");
  assert.ok(res.headers.get("x-download-options") || res.headers.get("origin-agent-cluster"));
});

test("security headers: /records/view/:recordId scopes frame-ancestors to CORS_ALLOWED_ORIGINS and sets cross-origin CORP", async (t) => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
  t.after(() => {
    if (previous !== undefined) process.env.CORS_ALLOWED_ORIGINS = previous;
    else delete process.env.CORS_ALLOWED_ORIGINS;
  });

  const app = createServerApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/records/view/non-existent-id`);
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp?.includes("frame-ancestors 'self' http://localhost:5173 http://localhost:3000"), "CSP must include frame-ancestors for CORS_ALLOWED_ORIGINS");
  assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
});

// ── 5. Rate limiting: returns 429 with plain error message ──
test("rate limiting: auth, upload, consent, and profile routes return 429 when limit exceeded", async (t) => {
  const servers = [];
  const stores = [];

  t.after(async () => {
    for (const store of stores) {
      try { store.shutdown?.(); } catch {}
    }
    for (const s of servers) {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  const createTestStore = (windowMs = 5000) => {
    const store = new MemoryStore();
    store.init({ windowMs });
    if (store.interval?.unref) store.interval.unref();
    stores.push(store);
    return store;
  };

  const wallet = ethers.Wallet.createRandom();
  const token = jwt.sign({ address: wallet.address.toLowerCase() }, JWT_SECRET, { expiresIn: "1h" });

  // A. Auth limiter (/auth/nonce/:address)
  const authStore = createTestStore(5000);
  const authRateLimiter = createAuthRateLimiter({ max: 2, windowMs: 5000, store: authStore });
  const authApp = express();
  authApp.use(express.json());
  authApp.use("/auth", createAuthRouter({ secret: JWT_SECRET, authRateLimiter }));

  const authServer = authApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => authServer.once("listening", resolve));
  servers.push(authServer);

  const authBase = `http://127.0.0.1:${authServer.address().port}/auth`;
  const r1 = await fetch(`${authBase}/nonce/${wallet.address}`);
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${authBase}/nonce/${wallet.address}`);
  assert.equal(r2.status, 200);
  const r3 = await fetch(`${authBase}/nonce/${wallet.address}`);
  assert.equal(r3.status, 429, "Auth route must return 429 when rate limit exceeded");
  const authErr = await r3.json();
  assert.match(authErr.error, /Too many (?:sign-in|login) attempts/i);

  // B. Record upload limiter (/records/upload)
  const uploadStore = createTestStore(5000);
  const uploadRateLimiter = createRecordUploadRateLimiter({ max: 2, windowMs: 5000, store: uploadStore });
  const recordsApp = express();
  recordsApp.use(express.json());
  recordsApp.use("/records", createRecordRouter({ uploadRateLimiter }));

  const recordsServer = recordsApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => recordsServer.once("listening", resolve));
  servers.push(recordsServer);

  const recordsBase = `http://127.0.0.1:${recordsServer.address().port}/records`;
  const u1 = await fetch(`${recordsBase}/upload`, { method: "POST" });
  assert.notEqual(u1.status, 429);
  const u2 = await fetch(`${recordsBase}/upload`, { method: "POST" });
  assert.notEqual(u2.status, 429);
  const u3 = await fetch(`${recordsBase}/upload`, { method: "POST" });
  assert.equal(u3.status, 429, "Upload route must return 429 when rate limit exceeded");
  const uploadErr = await u3.json();
  assert.match(uploadErr.error, /Too many upload attempts/i);

  // C. Consent limiter (/consent/request)
  const tmpConsentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-hardening-consent-"));
  const tmpReqStore = createConsentRequestStore(path.join(tmpConsentDir, "consent_requests.json"));
  const consentStore = createTestStore(5000);
  const consentRateLimiter = createConsentRateLimiter({ max: 2, windowMs: 5000, store: consentStore });
  const consentApp = express();
  consentApp.use(express.json());
  consentApp.use("/consent", createConsentRouter({ consentRateLimiter, requestStore: tmpReqStore, audit: () => {} }));

  const consentServer = consentApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => consentServer.once("listening", resolve));
  servers.push(consentServer);
  t.after(() => {
    try { fs.rmSync(tmpConsentDir, { recursive: true, force: true }); } catch {}
  });

  const consentBase = `http://127.0.0.1:${consentServer.address().port}/consent`;
  const c1 = await fetch(`${consentBase}/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ patientAddress: wallet.address })
  });
  assert.notEqual(c1.status, 429);
  const c2 = await fetch(`${consentBase}/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ patientAddress: wallet.address })
  });
  assert.notEqual(c2.status, 429);
  const c3 = await fetch(`${consentBase}/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ patientAddress: wallet.address })
  });
  assert.equal(c3.status, 429, "Consent route must return 429 when rate limit exceeded");
  const consentErr = await c3.json();
  assert.match(consentErr.error, /Too many consent requests/i);

  // D. Patient profile limiter (/patient/profile)
  const profileStore = createTestStore(5000);
  const patientProfileRateLimiter = createPatientProfileRateLimiter({ max: 2, windowMs: 5000, store: profileStore });
  const patientApp = express();
  patientApp.use(express.json());
  patientApp.use("/patient", createPatientRouter({ patientProfileRateLimiter }));

  const patientServer = patientApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => patientServer.once("listening", resolve));
  servers.push(patientServer);

  const patientBase = `http://127.0.0.1:${patientServer.address().port}/patient`;
  const p1 = await fetch(`${patientBase}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(p1.status, 200);
  const p2 = await fetch(`${patientBase}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(p2.status, 200);
  const p3 = await fetch(`${patientBase}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(p3.status, 429, "Profile route must return 429 when rate limit exceeded");
  const profileErr = await p3.json();
  assert.match(profileErr.error, /Too many profile requests/i);
});
