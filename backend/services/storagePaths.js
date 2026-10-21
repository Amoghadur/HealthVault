import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));
const DEFAULT_UPLOADS_DIR = fileURLToPath(new URL("../uploads", import.meta.url));

/**
 * Returns the configured data directory for JSON stores and audit logs.
 * Defaults to backend/data when HEALTHVAULT_DATA_DIR is not set.
 */
export function getDataDir() {
  const envDir = process.env.HEALTHVAULT_DATA_DIR;
  if (envDir && typeof envDir === "string" && envDir.trim()) {
    return path.resolve(envDir.trim());
  }
  return DEFAULT_DATA_DIR;
}

/**
 * Returns the configured uploads directory for encrypted records and records_metadata.json.
 * Defaults to backend/uploads when HEALTHVAULT_UPLOADS_DIR is not set.
 */
export function getUploadsDir() {
  const envDir = process.env.HEALTHVAULT_UPLOADS_DIR;
  if (envDir && typeof envDir === "string" && envDir.trim()) {
    return path.resolve(envDir.trim());
  }
  return DEFAULT_UPLOADS_DIR;
}

/**
 * Returns path to a specific file inside the data directory.
 */
export function getDataFilePath(fileName) {
  return path.join(getDataDir(), fileName);
}

/**
 * Returns path to a specific file inside the uploads directory.
 */
export function getUploadsFilePath(fileName) {
  return path.join(getUploadsDir(), fileName);
}

/**
 * Checks if custom persistent storage environment variables are configured.
 */
export function isPersistentStorageConfigured() {
  const data = process.env.HEALTHVAULT_DATA_DIR;
  const uploads = process.env.HEALTHVAULT_UPLOADS_DIR;
  return Boolean((data && data.trim()) || (uploads && uploads.trim()));
}

/**
 * Verifies that a directory exists, is a directory, and is writable.
 * Creates the directory recursively if it does not exist.
 * Never silently falls back if an explicitly configured directory is unavailable.
 */
function verifyDirectoryAccess(dirPath, isConfiguredPersistent, dirLabel) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path exists but is not a directory`);
    }

    // Verify write and delete access via a probe file
    const probeFile = path.join(
      dirPath,
      `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
    );
    fs.writeFileSync(probeFile, "ok", "utf8");
    fs.unlinkSync(probeFile);
  } catch (err) {
    if (isConfiguredPersistent) {
      throw new Error(
        `Configured persistent ${dirLabel} directory is unavailable: "${dirPath}". ${err.message}`
      );
    }
    throw new Error(
      `Storage ${dirLabel} directory is unavailable: "${dirPath}". ${err.message}`
    );
  }
}

/**
 * Ensures storage directories are present and accessible.
 * Fails startup if a configured persistent directory is unavailable,
 * preventing silent fallback to local ephemeral storage.
 */
export function ensureStorageDirectories({
  dataDir = getDataDir(),
  uploadsDir = getUploadsDir()
} = {}) {
  const isDataConfigured = Boolean(
    process.env.HEALTHVAULT_DATA_DIR && process.env.HEALTHVAULT_DATA_DIR.trim()
  );
  const isUploadsConfigured = Boolean(
    process.env.HEALTHVAULT_UPLOADS_DIR && process.env.HEALTHVAULT_UPLOADS_DIR.trim()
  );

  verifyDirectoryAccess(dataDir, isDataConfigured, "data");
  verifyDirectoryAccess(uploadsDir, isUploadsConfigured, "uploads");

  return { dataDir, uploadsDir };
}
