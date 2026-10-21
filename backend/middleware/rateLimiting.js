import rateLimit from "express-rate-limit";

/**
 * Factory for creating JSON rate limiters that return 429 with clean error messages.
 */
export function createStandardRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = "Too many requests. Please try again later.",
  statusCode = 429
} = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode,
    validate: { creationStack: false },
    handler: (req, res) => {
      res.status(statusCode).json({ error: message });
    }
  });
}

/**
 * Rate limiter for authentication endpoints (/auth/nonce and /auth/verify).
 * Protects against brute-force signature submissions and challenge flooding.
 */
export function createAuthRateLimiter(options = {}) {
  return createStandardRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: "Too many sign-in attempts. Please try again later.",
    ...options
  });
}

/**
 * Rate limiter for record uploads (/records/upload).
 * Protects server storage and pinning bandwidth.
 */
export function createRecordUploadRateLimiter(options = {}) {
  return createStandardRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many upload attempts. Please try again later.",
    ...options
  });
}

/**
 * Rate limiter for consent mutations (/consent/grant, /consent/revoke, /consent/request, /consent/respond).
 * Prevents flooding patient notifications and consent spam.
 */
export function createConsentRateLimiter(options = {}) {
  return createStandardRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: "Too many consent requests. Please try again later.",
    ...options
  });
}

/**
 * Rate limiter for patient profile reads and updates (/patient/profile).
 */
export function createPatientProfileRateLimiter(options = {}) {
  return createStandardRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: "Too many profile requests. Please try again later.",
    ...options
  });
}

/**
 * Rate limiter for Emergency QR creation and revocation (/consent/qr/generate, /consent/qr/revoke).
 * Protects against token generation spam and resource exhaustion.
 */
export function createEmergencyQrRateLimiter(options = {}) {
  return createStandardRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many emergency QR requests. Please try again later.",
    ...options
  });
}

/**
 * Rate limiter for public Emergency QR scan endpoint (/consent/qr/scan/:token).
 * Protects public scanning endpoint against denial-of-service and brute-force scans.
 */
export function createEmergencyScanRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 60;
  const message = options.message || "Too many emergency scan attempts. Please try again later.";
  const statusCode = options.statusCode || 429;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode,
    validate: { creationStack: false },
    ...options,
    handler: (req, res) => {
      const isJson = req.query?.format === "json" || (req.headers.accept && req.headers.accept.includes("application/json"));
      if (isJson) {
        return res.status(statusCode).json({ error: message });
      }
      res.status(statusCode).type("html").send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Rate Limit Exceeded — HealthVault</title>
          </head>
          <body style="font-family:Arial,sans-serif;text-align:center;padding:40px;background:#fff5f5">
            <h2 style="color:#C62828">⏳ Too Many Scan Requests</h2>
            <p>${message}</p>
          </body>
        </html>
      `);
    }
  });
}
