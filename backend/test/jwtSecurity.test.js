import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import jwt from "jsonwebtoken";
import { ethers } from "ethers";
import { createServerApp, validateJwtSecret } from "../server.js";

const OLD_DEFAULT_SECRET = "healthvault_secret_key_2024";

// ── 1. Unit tests for validateJwtSecret ──
test("validateJwtSecret: enforces minimum 32 characters and rejects missing or short values", () => {
  assert.throws(() => validateJwtSecret(null), /JWT_SECRET is required/);
  assert.throws(() => validateJwtSecret(undefined), /JWT_SECRET is required/);
  assert.throws(() => validateJwtSecret(""), /JWT_SECRET is required/);
  assert.throws(() => validateJwtSecret("   "), /JWT_SECRET is required/);
  assert.throws(() => validateJwtSecret(12345), /JWT_SECRET is required/);

  // Short secrets (< 32 characters)
  assert.throws(() => validateJwtSecret("short"), /must be at least 32 characters/);
  assert.throws(() => validateJwtSecret("a".repeat(31)), /must be at least 32 characters/);
  assert.throws(() => validateJwtSecret(OLD_DEFAULT_SECRET), /must be at least 32 characters/); // 27 chars!

  // Valid secrets (>= 32 characters)
  assert.equal(validateJwtSecret("a".repeat(32)), "a".repeat(32));
  assert.equal(validateJwtSecret("a".repeat(64)), "a".repeat(64));
});

// ── 2. Server startup refusal on missing or short JWT_SECRET ──
test("server startup: refuses to start with code 1 and fatal error if JWT_SECRET is missing or < 32 characters", async () => {
  const serverPath = path.resolve("server.js");

  // A. Missing JWT_SECRET
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [serverPath],
      { env: { ...process.env, JWT_SECRET: "" } },
      (err, stdout, stderr) => {
        assert.ok(err, "Process must exit with error");
        assert.equal(err.code, 1);
        assert.match(stderr, /FATAL: Failed to start server due to invalid JWT_SECRET configuration/);
        assert.match(stderr, /JWT_SECRET is required/);
        resolve();
      }
    );
  });

  // B. Too short JWT_SECRET (< 32 chars)
  await new Promise((resolve) => {
    execFile(
      process.execPath,
      [serverPath],
      { env: { ...process.env, JWT_SECRET: "weak-short-secret" } },
      (err, stdout, stderr) => {
        assert.ok(err, "Process must exit with error");
        assert.equal(err.code, 1);
        assert.match(stderr, /FATAL: Failed to start server due to invalid JWT_SECRET configuration/);
        assert.match(stderr, /must be at least 32 characters/);
        resolve();
      }
    );
  });
});

// ── 3. Token signed with old default secret is rejected with 401 ──
test("security: tokens signed with the old default secret are rejected with 401", async (t) => {
  const currentSecret = process.env.JWT_SECRET;
  assert.ok(currentSecret && currentSecret.length >= 32, "Current JWT_SECRET must be at least 32 characters");
  assert.notEqual(currentSecret, OLD_DEFAULT_SECRET, "Current secret must not equal old default secret");

  const app = createServerApp({ jwtSecret: currentSecret });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const wallet = ethers.Wallet.createRandom();

  // Forged token signed with the old default secret
  const forgedOldToken = jwt.sign(
    { address: wallet.address.toLowerCase(), role: "doctor" },
    OLD_DEFAULT_SECRET,
    { expiresIn: "1h" }
  );

  // A. Protected route /records/doctor
  const resDoctor = await fetch(`${base}/records/doctor`, {
    headers: { Authorization: `Bearer ${forgedOldToken}` },
  });
  assert.equal(resDoctor.status, 401, "/records/doctor must reject token signed with old default secret with 401");

  // B. Protected route /patient/profile
  const resProfile = await fetch(`${base}/patient/profile`, {
    headers: { Authorization: `Bearer ${forgedOldToken}` },
  });
  assert.equal(resProfile.status, 401, "/patient/profile must reject token signed with old default secret with 401");

  // C. Protected route /records/view/:recordId
  const resView = await fetch(`${base}/records/view/dummy-id`, {
    headers: { Authorization: `Bearer ${forgedOldToken}` },
  });
  assert.equal(resView.status, 401, "/records/view must reject token signed with old default secret with 401");

  // D. Valid token signed with current secret is recognized
  const validToken = jwt.sign(
    { address: wallet.address.toLowerCase(), role: "patient" },
    currentSecret,
    { expiresIn: "1h" }
  );
  const resValid = await fetch(`${base}/patient/profile`, {
    headers: { Authorization: `Bearer ${validToken}` },
  });
  // Should not be 401 Unauthorized for valid token
  assert.notEqual(resValid.status, 401, "Valid token signed with current secret must not be rejected with 401");
});

// ── 4. Query parameter ?token= is rejected with 401 ──
test("security: query parameter ?token= is rejected with 401 on /records/view/:recordId", async (t) => {
  const currentSecret = process.env.JWT_SECRET;
  const app = createServerApp({ jwtSecret: currentSecret });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const wallet = ethers.Wallet.createRandom();
  const validToken = jwt.sign(
    { address: wallet.address.toLowerCase(), role: "patient" },
    currentSecret,
    { expiresIn: "1h" }
  );

  // Attempting to pass token via ?token= query parameter without Authorization header must return 401
  const resQueryToken = await fetch(`${base}/records/view/dummy-id?token=${validToken}`);
  assert.equal(resQueryToken.status, 401, "GET /records/view/:recordId?token= must be rejected with 401");
  const text = await resQueryToken.text();
  assert.match(text, /Not authenticated/);
});
