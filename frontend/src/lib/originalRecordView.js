// Diagnostics deliberately exclude URLs, identities, tokens, response bodies and content.
export function startOriginalRecordView({
  recordId, patientAddress, baseUrl, token, onState, onStatusRefresh,
  fetchImpl = fetch, urlApi = URL, timeoutMs = 30000,
  diagnostic = event => console.debug('HealthVault record viewer', event),
}) {
  const controller = new AbortController();
  let closed = false, objectUrl, expiryTimer, stage = 'consent';
  const started = Date.now();
  const report = (operation, at, status, category) => {
    try { diagnostic({ operation, durationMs: Math.max(0, Date.now() - at), httpStatus: status, category, closed }); }
    catch { /* Diagnostics must never affect viewing or authorization. */ }
  };
  const clearBlob = () => {
    if (objectUrl) urlApi.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };
  const fail = (message, category) => {
    if (closed) return;
    closed = true;
    controller.abort();
    clearTimeout(expiryTimer);
    clearBlob();
    report(stage, started, null, category);
    onState({ status: 'error', error: message });
  };
  const error = (message, category) => Object.assign(new Error(message), { category });
  const request = async (operation, path, consume) => {
    stage = operation;
    const at = Date.now();
    let timer, abort, status = null;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(error('Viewer closed.', 'CLOSED'));
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    try {
      const result = await Promise.race([
        (async () => {
          let response;
          try {
            response = await fetchImpl(baseUrl + path, {
              headers: { Authorization: `Bearer ${token}` },
              signal: controller.signal, cache: 'no-store', redirect: 'error',
            });
          } catch { throw error('Cannot reach HealthVault. Check your connection, then close and reopen the viewer.', 'NETWORK'); }
          status = response.status;
          if (!response.ok) {
            const messages = {
              401: 'Your session has expired. Sign out and reconnect.',
              403: 'Access denied. Patient consent has expired or been revoked.',
              404: 'The original record is no longer available. Contact the uploader.',
              500: operation === 'consent' ? 'Consent verification failed. Close and retry later.' : 'The server could not read or decrypt this record. Contact the administrator.',
              502: 'Record retrieval failed. Close and retry later.',
              503: 'Patient consent could not be verified on-chain. Close and retry later.',
              504: 'The server request timed out. Close and retry later.',
            };
            throw error(messages[status] || 'The record request failed. Close and retry later.', 'HTTP_ERROR');
          }
          if (closed) throw error('Viewer closed.', 'CLOSED');
          return consume(response);
        })(),
        cancelled,
        new Promise((_, reject) => { timer = setTimeout(() => reject(error(
          operation === 'consent' ? 'Consent verification timed out. Close and retry later.' : 'The original record download timed out. Close and retry later.', 'TIMEOUT')), timeoutMs); }),
      ]);
      report(operation, at, status, 'SUCCESS');
      return result;
    } catch (failure) {
      report(operation, at, status, failure?.category || 'UNEXPECTED');
      throw failure;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  };
  const done = (async () => {
    try {
      onState({ status: 'loading', message: 'Checking consent and loading original record…' });
      if (!token) throw error('Your session has expired. Sign out and reconnect.', 'SESSION');
      const check = await request('consent', `/records/check/${encodeURIComponent(patientAddress)}`, async response => {
        try { return await response.json(); }
        catch { throw error('The consent service returned an unreadable response. Close and retry later.', 'INVALID_RESPONSE'); }
      });
      if (closed) return;
      if (check?.hasAccess !== true) throw error(
        check?.status === 'expired' ? 'Access denied. Temporary patient consent has expired.' :
          check?.status === 'revoked' ? 'Access denied. Patient consent has been revoked.' :
            'Access denied. Current patient consent could not be confirmed.', 'CONSENT_DENIED');
      if (check.expiresAt) {
        const remaining = Date.parse(check.expiresAt) - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) throw error('Access denied. Temporary patient consent has expired.', 'CONSENT_EXPIRED');
        expiryTimer = setTimeout(() => fail('Temporary patient consent has expired. Close the viewer and request access again.', 'CONSENT_EXPIRED'), Math.min(remaining, 2147483647));
      }
      // The parent callback is stable; reporting success must not restart this effect.
      onStatusRefresh?.(patientAddress, check);
      if (closed) return;
      onState({ status: 'loading', message: 'Loading the authorized original record…' });
      const blob = await request('record', `/records/view/${encodeURIComponent(recordId)}`, async response => {
        if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('content-type') || '')) {
          throw error('The server returned an unexpected file format. Contact the administrator.', 'INVALID_RESPONSE');
        }
        let value;
        try { value = await response.blob(); }
        catch { throw error('The record download was interrupted. Close and retry later.', 'BODY_ERROR'); }
        if (!value.size) throw error('The server returned an empty record. Contact the administrator.', 'INVALID_RESPONSE');
        return value;
      });
      if (closed) return;
      if (check.expiresAt && Date.parse(check.expiresAt) <= Date.now()) throw error('Temporary patient consent has expired.', 'CONSENT_EXPIRED');
      stage = 'render';
      objectUrl = urlApi.createObjectURL(blob);
      onState({ status: 'ready', url: objectUrl });
      report('render', started, null, 'SUCCESS');
    } catch (failure) {
      fail(failure?.category ? failure.message : 'The original record could not be displayed. Close the viewer and retry later.', failure?.category || 'UNEXPECTED');
    }
  })();
  return {
    done,
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      clearTimeout(expiryTimer);
      clearBlob();
      report(stage, started, null, 'CLOSED');
    },
  };
}
