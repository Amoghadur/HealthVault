import { URL } from "node:url";

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "0"
]);

const FORBIDDEN_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".test",
  ".example",
  ".invalid"
];

/**
 * Checks whether an IPv4 address belongs to a private/local network:
 * - 10.0.0.0/8
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local)
 * - 100.64.0.0/10 (carrier-grade NAT)
 * - 0.0.0.0/8
 */
function isPrivateIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const [_, a, b, c, d] = match.map(Number);
  if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return true;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;

  return false;
}

/**
 * Validates whether an EMERGENCY_QR_BASE_URL string is a valid public HTTPS endpoint
 * suitable for cross-device scanning (mobile phones on cellular data/external networks).
 *
 * Rejects:
 * - Missing or empty strings
 * - Invalid URL formats
 * - Non-HTTPS protocols (http, ftp, etc.)
 * - Localhost and loopback IPs
 * - Private LAN IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x)
 * - Development-only domain suffixes (.local, .internal, .lan, etc.)
 * - Unqualified single-word hostnames (e.g. "my-laptop")
 */
export function validateEmergencyQrBaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      error: "EMERGENCY_QR_BASE_URL is not configured. An absolute HTTPS public URL is required for cross-device QR scanning."
    };
  }

  const trimmed = rawUrl.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: "EMERGENCY_QR_BASE_URL must be a valid absolute URL."
    };
  }

  // Enforce HTTPS
  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `EMERGENCY_QR_BASE_URL protocol must be 'https:' (received '${parsed.protocol}'). Cross-device camera scanners require HTTPS.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Enforce non-loopback
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return {
      valid: false,
      error: `EMERGENCY_QR_BASE_URL cannot use localhost/loopback address ('${hostname}'). It cannot be reached by external devices.`
    };
  }

  // Enforce non-private LAN IP
  if (isPrivateIpv4(hostname)) {
    return {
      valid: false,
      error: `EMERGENCY_QR_BASE_URL cannot use private LAN IP address ('${hostname}'). Mobile phones on cellular networks cannot reach private IP addresses.`
    };
  }

  // Enforce forbidden development suffixes
  for (const suffix of FORBIDDEN_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        valid: false,
        error: `EMERGENCY_QR_BASE_URL cannot use private/development hostname ending with '${suffix}'.`
      };
    }
  }

  // Must have a qualified domain (contains at least one dot, or valid public domain)
  if (!hostname.includes(".")) {
    return {
      valid: false,
      error: `EMERGENCY_QR_BASE_URL hostname ('${hostname}') must be a fully qualified public domain or tunnel host.`
    };
  }

  return {
    valid: true,
    parsed
  };
}

/**
 * Builds an absolute scan URL using the verified public base URL and emergency token.
 * Normalizes path segments to prevent duplicate slashes or duplicated '/consent/qr/scan' segments.
 */
export function buildEmergencyScanUrl(baseUrl, token) {
  if (!token || typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token.trim())) {
    throw new Error("Invalid emergency token format. Must be a 64-character hexadecimal string.");
  }

  const validation = validateEmergencyQrBaseUrl(baseUrl);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const cleanToken = token.trim().toLowerCase();
  const parsed = new URL(validation.parsed.href);

  // Strip trailing slashes from pathname
  let basePath = parsed.pathname.replace(/\/+$/, "");

  // If basePath already ends with /consent/qr/scan, don't duplicate
  if (basePath.endsWith("/consent/qr/scan")) {
    parsed.pathname = `${basePath}/${cleanToken}`;
  } else if (basePath.endsWith("/qr/scan")) {
    parsed.pathname = `${basePath}/${cleanToken}`;
  } else {
    // Normal base URL (e.g. https://my-tunnel.trycloudflare.com or https://api.healthvault.org)
    const prefix = basePath ? basePath : "";
    parsed.pathname = `${prefix}/consent/qr/scan/${cleanToken}`;
  }

  return parsed.toString();
}

/**
 * Helper to inspect the current environment's emergency QR base URL configuration.
 */
export function getEmergencyQrConfig(customBaseUrl = process.env.EMERGENCY_QR_BASE_URL) {
  const validation = validateEmergencyQrBaseUrl(customBaseUrl);
  if (!validation.valid) {
    return {
      configured: false,
      baseUrl: null,
      host: null,
      error: validation.error
    };
  }
  return {
    configured: true,
    baseUrl: validation.parsed.origin,
    host: validation.parsed.host,
    error: null
  };
}
