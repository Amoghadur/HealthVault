import { ethers } from "ethers";

/**
 * Formats a dispatched timestamp into a human-readable local time string.
 * Supports ISO strings, numeric timestamps (ms since epoch), and numeric strings.
 * Falls back safely to "Request time unavailable" when missing or invalid.
 * Never fabricates dates.
 */
export function formatDispatchedTime(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return "Request time unavailable";
  }

  let dateObj;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return "Request time unavailable";
    dateObj = new Date(raw);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "Request time unavailable";
    // Check if numeric string representing milliseconds (10 to 16 digits)
    if (/^\d{10,16}$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num <= 0) return "Request time unavailable";
      dateObj = new Date(num);
    } else {
      dateObj = new Date(trimmed);
    }
  } else if (raw instanceof Date) {
    dateObj = raw;
  } else {
    return "Request time unavailable";
  }

  if (!dateObj || isNaN(dateObj.getTime())) {
    return "Request time unavailable";
  }

  return dateObj.toLocaleString();
}

/**
 * Resolves the real request status according to actual request data and authorization state:
 * - Awaiting Approval: Pending request whose TTL has not expired.
 * - Approved: Request was approved AND consent is confirmed active.
 * - Rejected: Request was explicitly rejected by the patient.
 * - Expired: Request TTL expired, or temporary grant duration ended.
 * - Revoked: Consent grant was revoked on-chain or backend.
 *
 * Critical rule: Does NOT treat an approved request as proof that consent is still active.
 */
export function getRequestDisplayInfo(req, selectedPatientAddress, accessDetail) {
  const isSelected = Boolean(
    selectedPatientAddress &&
    typeof selectedPatientAddress === "string" &&
    ethers.isAddress(selectedPatientAddress) &&
    (req?.patientAddress || "").toLowerCase() === selectedPatientAddress.toLowerCase()
  );

  const rawStatus = (req?.status || "").toLowerCase().trim();
  const authStatus = (req?.authorizationStatus || "").toLowerCase().trim();
  const now = Date.now();

  // 1. Authoritative live access check if this patient address matches lookup
  if (isSelected && accessDetail?.status) {
    const detailStatus = String(accessDetail.status).toLowerCase();
    if (detailStatus === "active" && (rawStatus === "accepted" || rawStatus === "approved" || authStatus === "approved" || authStatus === "active")) {
      return {
        statusKey: "approved",
        label: "Approved",
        icon: "✓",
        badgeClass: "badge-approved",
        color: "var(--status-success-text, #166534)",
        bg: "var(--status-success-bg, #dcfce7)",
        isConsentActive: true
      };
    }
    if (detailStatus === "expired") {
      return {
        statusKey: "expired",
        label: "Expired",
        icon: "⌛",
        badgeClass: "badge-expired",
        color: "var(--text-tertiary, #64748b)",
        bg: "var(--bg-surface-subtle, #f1f5f9)",
        isConsentActive: false
      };
    }
    if (detailStatus === "revoked") {
      return {
        statusKey: "revoked",
        label: "Revoked",
        icon: "⊘",
        badgeClass: "badge-revoked",
        color: "var(--status-error-text, #991b1b)",
        bg: "var(--status-error-bg, #fee2e2)",
        isConsentActive: false
      };
    }
  }

  // 2. Explicit authorization state from backend expiry store
  if (authStatus === "revoked" || rawStatus === "revoked") {
    return {
      statusKey: "revoked",
      label: "Revoked",
      icon: "⊘",
      badgeClass: "badge-revoked",
      color: "var(--status-error-text, #991b1b)",
      bg: "var(--status-error-bg, #fee2e2)",
      isConsentActive: false
    };
  }

  if (authStatus === "expired" || rawStatus === "expired") {
    return {
      statusKey: "expired",
      label: "Expired",
      icon: "⌛",
      badgeClass: "badge-expired",
      color: "var(--text-tertiary, #64748b)",
      bg: "var(--bg-surface-subtle, #f1f5f9)",
      isConsentActive: false
    };
  }

  if (authStatus === "rejected" || rawStatus === "rejected") {
    return {
      statusKey: "rejected",
      label: "Rejected",
      icon: "✕",
      badgeClass: "badge-rejected",
      color: "var(--status-error-text, #991b1b)",
      bg: "var(--status-error-bg, #fee2e2)",
      isConsentActive: false
    };
  }

  // 3. Pending requests: check if request TTL has expired
  if (rawStatus === "pending") {
    if (req?.expiresAt && Date.parse(req.expiresAt) <= now) {
      return {
        statusKey: "expired",
        label: "Expired",
        icon: "⌛",
        badgeClass: "badge-expired",
        color: "var(--text-tertiary, #64748b)",
        bg: "var(--bg-surface-subtle, #f1f5f9)",
        isConsentActive: false
      };
    }
    return {
      statusKey: "awaiting_approval",
      label: "Awaiting Approval",
      icon: "⏳",
      badgeClass: "badge-awaiting",
      color: "var(--status-warning-text, #92400e)",
      bg: "var(--status-warning-bg, #fef3c7)",
      isConsentActive: false
    };
  }

  // 4. Accepted / Approved requests:
  // If backend explicitly confirms authStatus is active/approved, and not expired
  if (authStatus === "approved" || authStatus === "active") {
    return {
      statusKey: "approved",
      label: "Approved",
      icon: "✓",
      badgeClass: "badge-approved",
      color: "var(--status-success-text, #166534)",
      bg: "var(--status-success-bg, #dcfce7)",
      isConsentActive: true
    };
  }

  // An approved request from the past without active consent proof is Expired
  if (rawStatus === "accepted" || rawStatus === "approved") {
    return {
      statusKey: "expired",
      label: "Expired",
      icon: "⌛",
      badgeClass: "badge-expired",
      color: "var(--text-tertiary, #64748b)",
      bg: "var(--bg-surface-subtle, #f1f5f9)",
      isConsentActive: false
    };
  }

  return {
    statusKey: "unknown",
    label: req?.status || "Unknown",
    icon: "•",
    badgeClass: "badge-unknown",
    color: "var(--text-secondary, #475569)",
    bg: "var(--bg-surface-subtle, #f1f5f9)",
    isConsentActive: false
  };
}

/**
 * Deduplicates request entries by stable id while preserving separate legitimate requests with distinct IDs.
 */
export function deduplicateRequests(rawRequests) {
  if (!Array.isArray(rawRequests)) return [];
  const seen = new Set();
  const deduped = [];
  for (const r of rawRequests) {
    if (!r || r.id === undefined || r.id === null) continue;
    const id = String(r.id);
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push({ ...r, id });
    }
  }
  return deduped;
}

/**
 * Identifies which specific request card (if any) represents the currently active patient in preflight.
 * Returns the request ID of that active card, or null if no preflight selection is active.
 */
export function getActivePreflightRequestId(requests, isPatientFound, patientAddress) {
  if (!isPatientFound || !patientAddress || !ethers.isAddress(patientAddress)) {
    return null;
  }
  const normalized = patientAddress.toLowerCase();
  // Find the most recent request matching this patient address
  const match = requests.find(r => (r?.patientAddress || "").toLowerCase() === normalized);
  return match ? match.id : null;
}
