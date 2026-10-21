export const auditLabels = {
  RecordUploaded: 'Record upload recorded', AccessGranted: 'Access granted', AccessRevoked: 'Access revoked',
  RecordStored: 'Record stored on server', RecordDeleted: 'Local record deleted', RecordServed: 'Record response sent',
  RecordAccessDenied: 'Record request denied', RecordUploadDenied: 'Record upload denied', AccessRequested: 'Access requested',
  RequestAccepted: 'Request accepted (backend)', RequestRejected: 'Request rejected',
  EmergencyCreated: 'Emergency QR created', EmergencyServed: 'Emergency response sent',
};

export function transactionUrl(event) {
  return event.source === 'blockchain' && /^0x[0-9a-fA-F]{64}$/.test(event.transactionHash || '')
    ? `https://sepolia.etherscan.io/tx/${event.transactionHash}` : null;
}

export function localDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function filterAuditEvents(events, { source = 'all', action = 'all', date = '', query = '', wallet = '' } = {}) {
  const search = query.trim().toLowerCase();
  const address = wallet.trim().toLowerCase();
  return events.filter(event => (source === 'all' || event.source === source)
    && (action === 'all' || event.action === action)
    && (!date || localDate(event.timestamp) === date)
    && [event.actor, event.patient, event.doctor].some(value => (value || '').toLowerCase().includes(address))
    && [auditLabels[event.action] || event.action, event.actor, event.patient, event.doctor, event.recordId, event.transactionHash]
      .join(' ').toLowerCase().includes(search));
}
