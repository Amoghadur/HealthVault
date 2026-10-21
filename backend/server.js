import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.js";
import recordRoutes from "./routes/records.js";
import consentRoutes from "./routes/consent.js";
import auditRoutes from "./routes/audit.js";
import profileRoutes from "./routes/profiles.js";
import appointmentRoutes from "./routes/appointments.js";
import patientRoutes from "./routes/patient.js";
import path from "path";
import { fileURLToPath } from "url";
import { encryptedFilesOnly } from "./middleware/recordAccess.js";
import { validateMasterSecret, migrateRecordsMetadata } from "./services/keyManagement.js";
import { getDataDir, getUploadsDir, ensureStorageDirectories } from "./services/storagePaths.js";

export function validateJwtSecret(...args) {
  const secret = args.length > 0 ? args[0] : process.env.JWT_SECRET;
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("JWT_SECRET is required.");
  }
  if (secret.length < 32) {
    throw new Error(`JWT_SECRET must be at least 32 characters long (received ${secret.length}).`);
  }
  return secret;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

// Validate secrets at startup and run migration when executed directly
let masterKeyBuffer;
if (isMainModule) {
  try {
    validateJwtSecret(process.env.JWT_SECRET);
  } catch (err) {
    console.error("FATAL: Failed to start server due to invalid JWT_SECRET configuration:");
    console.error(err.message);
    process.exit(1);
  }

  try {
    masterKeyBuffer = validateMasterSecret(process.env.RECORD_KEY_ENCRYPTION_SECRET);
  } catch (err) {
    console.error("FATAL: Failed to start server due to invalid RECORD_KEY_ENCRYPTION_SECRET configuration:");
    console.error(err.message);
    process.exit(1);
  }

  // Ensure persistent storage directories exist and are accessible
  try {
    ensureStorageDirectories();
  } catch (err) {
    console.error("FATAL: Failed to initialize storage directories on startup:");
    console.error(err.message);
    process.exit(1);
  }

  // Run one-time idempotent migration of records metadata
  try {
    const migration = migrateRecordsMetadata({ uploadsDir: getUploadsDir(), masterKeyBuffer });
    if (migration.migrated) {
      console.log(`Migrated ${migration.count} record key(s) to encrypted-at-rest. Backup saved to ${migration.backupPath}`);
    }
  } catch (err) {
    console.error("FATAL: Failed to migrate records metadata on startup:", err.message);
    process.exit(1);
  }
}

export function createServerApp({ allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS, extraRoutes, jwtSecret = process.env.JWT_SECRET } = {}) {
  validateJwtSecret(jwtSecret);
  const app = express();

  // 1. Security headers via Helmet (sensible defaults, cross-origin resource policy for static assets/iframe viewing)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
      frameguard: false
    })
  );

  // 2. CORS Allowlist
  const allowedOrigins = (allowedOriginsEnv || "http://localhost:5173")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true
    })
  );

  // 3. Request body limits (1MB for JSON payloads; rejects oversized payloads with 413)
  app.use(express.json({ limit: "1mb" }));

  // Routes
  app.use("/appointments", appointmentRoutes);
  app.use("/auth", authRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/records", recordRoutes);
  app.use("/consent", consentRoutes);
  app.use("/api/consent", consentRoutes);
  app.use("/profiles", profileRoutes);
  app.use("/patient", patientRoutes);
  app.use("/api/patient", patientRoutes);
  app.use("/audit", auditRoutes);
  app.use("/files", encryptedFilesOnly, express.static(getUploadsDir()));

  // Health check — open this in browser to confirm backend works
  app.get("/", (req, res) => {
    res.json({
      status: "running",
      project: "HealthVault Backend",
      contract: process.env.CONTRACT_ADDRESS,
      network: "Ethereum Sepolia Testnet",
      routes: {
        auth: "/auth/nonce/:address  |  /auth/verify",
        records: "/records/upload  |  /records/check/:patientAddress",
        consent: "/consent/grant  |  /consent/status/:doctorAddress"
      }
    });
  });

  if (typeof extraRoutes === "function") {
    extraRoutes(app);
  }

  // 5. Central Error Handler: returns status code and generic message without stack traces or internal paths
  app.use(centralErrorHandler);

  return app;
}

export function centralErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (
    err.status === 413 ||
    err.statusCode === 413 ||
    err.type === "entity.too.large" ||
    err.code === "LIMIT_FILE_SIZE"
  ) {
    console.error(`[PayloadTooLarge] ${req.method} ${req.path}`);
    return res.status(413).json({ error: "Payload too large." });
  }

  if (err.status === 400 || err.statusCode === 400 || err.type === "entity.parse.failed") {
    console.error(`[BadRequest] ${req.method} ${req.path}: Malformed payload.`);
    return res.status(400).json({ error: "Invalid request payload." });
  }

  const statusCode = typeof err.status === "number" && err.status >= 400 && err.status < 600
    ? err.status
    : typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;

  console.error(`[InternalError] ${req.method} ${req.path}: ${err.message}`);

  const genericMessage = statusCode === 500
    ? "An internal server error occurred."
    : (err.message && !err.message.includes("\\") && !err.message.includes("/") && err.message.length < 120)
      ? err.message
      : "Request failed.";

  res.status(statusCode).json({ error: genericMessage });
}

const app = createServerApp();
const PORT = process.env.PORT || 4000;

if (isMainModule) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("─────────────────────────────────────");
    console.log(`  HealthVault Backend Running`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  Contract: ${process.env.CONTRACT_ADDRESS}`);
    console.log("─────────────────────────────────────");
  });
}

export default app;
