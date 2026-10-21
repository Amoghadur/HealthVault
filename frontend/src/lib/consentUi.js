// Presentation only. Protected operations still use backend authorization.
export function consentPresentation(detail, now = Date.now()) {
  let status = detail?.status || 'checking';
  const expiry = Date.parse(detail?.expiresAt);
  const remaining = Number.isFinite(expiry)
    ? Math.max(0, Math.ceil((expiry - now) / 1000))
    : null;
  if (status === 'active' && detail?.hasAccess === false) status = 'verification-unavailable';
  if (status === 'active' && remaining === 0) status = 'expired';
  const labels = {
    active: 'Active', expired: 'Expired', revoked: 'Revoked', checking: 'Checking',
    none: 'No access granted', 'verification-unavailable': 'Unable to Verify',
  };
  if (!Object.hasOwn(labels, status)) status = 'verification-unavailable';
  const descriptions = {
    active: 'Access is limited to the selected duration.',
    expired: 'The access duration has ended. A new grant is needed.',
    revoked: 'Consent has been revoked. A new grant is needed.',
    checking: 'Checking current access…',
    none: 'No current temporary grant is available.',
    'verification-unavailable': 'Current access could not be verified. Retry the access check.',
  };
  return {
    status, label: labels[status], description: descriptions[status],
    countdown: status === 'active' && remaining !== null
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining` : null,
    endingSoon: status === 'active' && remaining !== null && remaining > 0 && remaining < 60,
  };
}

export function getShareableRecords(records = [], doctorAddress = "") {
  if (!doctorAddress) return records || [];
  const target = String(doctorAddress).toLowerCase().trim();
  return (records || []).filter(r => {
    const uploader = (r.doctorAddress || "").toLowerCase().trim();
    return uploader !== target;
  });
}
