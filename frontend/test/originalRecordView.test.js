import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startOriginalRecordView } from '../src/lib/originalRecordView.js';

const active = { hasAccess: true, status: 'active', expiresAt: new Date(Date.now() + 600000).toISOString() };
const pdf = new Blob(['%PDF-1.4\nSynthetic PDF fixture\n%%EOF'], { type: 'application/pdf' });
const consent = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const documentResponse = () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
function fixture(t, fetchImpl, options = {}) {
  const states = [], events = [], blobs = [], revoked = [], calls = [];
  const attempt = startOriginalRecordView({
    recordId: 'synthetic-record', patientAddress: 'synthetic-patient', baseUrl: 'http://fixture.invalid',
    token: 'synthetic-secret', onState: value => states.push(value),
    diagnostic: event => events.push(event),
    fetchImpl: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    urlApi: { createObjectURL: blob => { blobs.push(blob); return 'blob:synthetic'; }, revokeObjectURL: url => revoked.push(url) },
    timeoutMs: 50, ...options,
  });
  t.after(() => attempt.close());
  return { attempt, states, events, blobs, revoked, calls };
}
test('actual stable parent callback does not cancel record loading on successful preflight or countdown rerender', async t => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');
  const declaration = source.match(/const handleRecordStatusRefresh = useCallback\([\s\S]*?\}, \[patientAddress\]\);/);
  assert.ok(declaration, 'parent must memoize the callback by patient, not by changing status/countdown');
  assert.ok(source.includes('onStatusRefresh={handleRecordStatusRefresh}'));
  let cached, savedDependencies, detail, parentRenders = 0, closes = 0;
  let f;
  const useCallback = (callback, deps) => {
    if (!cached || deps.some((value, i) => value !== savedDependencies[i])) { cached = callback; savedDependencies = deps; }
    return cached;
  };
  const render = () => new Function('useCallback', 'patientAddress', 'setAccessStatus', 'setAccessDetail',
    declaration[0] + '; return handleRecordStatusRefresh;')(useCallback, 'synthetic-patient', () => {}, value => {
      detail = value; parentRenders++;
      const next = render();
      if (next !== first) { closes++; f?.attempt.close(); }
    });
  const first = render();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f = fixture(t, async url => url.includes('/check/') ? consent(active) : pending, { onStatusRefresh: first });
  await new Promise(resolve => setTimeout(resolve, 0));
  detail = { ...detail, remainingSeconds: 30 }; // countdown updates parent state
  assert.equal(detail.remainingSeconds, 30);
  assert.equal(render(), first);
  release(documentResponse());
  await f.attempt.done;
  assert.equal(parentRenders, 1);
  assert.equal(closes, 0);
  assert.equal(f.states.at(-1).status, 'ready');
  assert.equal(f.calls.length, 2);
  assert.equal(await f.blobs[0].text(), await pdf.text());
});
test('denied, expired and revoked preflight never request protected content', async t => {
  for (const status of ['expired', 'revoked', 'none']) {
    const f = fixture(t, async () => consent({ hasAccess: false, status }));
    await f.attempt.done;
    assert.equal(f.states.at(-1).status, 'error');
    assert.equal(f.calls.length, 1);
    assert.equal(f.blobs.length, 0);
  }
});
test('failed consent HTTP and malformed consent data show an error', async t => {
  for (const response of [new Response('private body', { status: 503 }), new Response('bad json'), consent({ hasAccess: 'true' })]) {
    const f = fixture(t, async () => response);
    await f.attempt.done;
    assert.equal(f.states.at(-1).status, 'error');
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(f.states.at(-1).error, /private body|bad json/);
  }
});
test('failed retrieval including decryption errors cannot remain loading', async t => {
  for (const status of [401, 403, 404, 500, 502, 503, 504]) {
    const f = fixture(t, async url => url.includes('/check/') ? consent(active) : new Response('private provider details', { status }));
    await f.attempt.done;
    assert.equal(f.states.at(-1).status, 'error');
    assert.equal(f.blobs.length, 0);
    assert.doesNotMatch(f.states.at(-1).error, /private provider/);
    assert.ok(f.events.some(event => event.operation === 'record' && event.httpStatus === status));
  }
});
test('rejected fetches and unexpected non-Error throws end in safe errors', async t => {
  for (const operation of ['consent', 'record', 'render']) {
    const f = fixture(t, async url => {
      if (operation === 'consent' || (operation === 'record' && url.includes('/view/'))) throw null;
      return url.includes('/check/') ? consent(active) : documentResponse();
    }, operation === 'render' ? { urlApi: { createObjectURL: () => { throw null; } } } : {});
    await f.attempt.done;
    assert.equal(f.states.at(-1).status, 'error');
  }
});
test('pending consent, retrieval and response bodies all time out', async t => {
  for (const stage of ['consent', 'record', 'body']) {
    const pending = new Promise(() => {});
    const f = fixture(t, async url => {
      if (url.includes('/check/')) return stage === 'consent' ? pending : consent(active);
      if (stage === 'record') return pending;
      const response = documentResponse(); response.blob = () => pending; return response;
    }, { timeoutMs: 10 });
    await f.attempt.done;
    assert.equal(f.states.at(-1).status, 'error');
    assert.match(f.states.at(-1).error, /timed out/);
    assert.equal(f.calls[0].init.signal.aborted, true);
    assert.ok(f.events.some(event => event.category === 'TIMEOUT'));
  }
});
test('close during each pending stage prevents status refresh, URLs and stale UI updates', async t => {
  for (const stage of ['consent', 'record', 'body']) {
    let release, updates = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture(t, async url => {
      if (url.includes('/check/')) return stage === 'consent' ? pending : consent(active);
      if (stage === 'record') return pending;
      const response = documentResponse(); response.blob = () => pending; return response;
    }, { onStatusRefresh: () => updates++ });
    await new Promise(resolve => setTimeout(resolve, 0));
    f.attempt.close();
    const count = f.states.length, priorUpdates = updates;
    release(stage === 'consent' ? consent(active) : stage === 'record' ? documentResponse() : pdf);
    await f.attempt.done;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.states.length, count);
    assert.equal(updates, priorUpdates);
    assert.equal(f.blobs.length, 0);
    assert.ok(f.events.some(event => event.closed && event.category === 'CLOSED'));
  }
});
test('known grant expiry hides an open document and revokes its blob URL', async t => {
  const f = fixture(t, async url => url.includes('/check/')
    ? consent({ ...active, expiresAt: new Date(Date.now() + 30).toISOString() }) : documentResponse());
  await f.attempt.done;
  assert.equal(f.states.at(-1).status, 'ready');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(f.states.at(-1).status, 'error');
  assert.deepEqual(f.revoked, ['blob:synthetic']);
});
test('wrong media, empty data and failed blob reads fail safely', async t => {
  for (const response of [new Response('<html>error</html>'), new Response(new Blob([], { type: 'application/pdf' })), documentResponse()]) {
    if (response === undefined) continue;
    if (response.headers.get('content-type') === 'application/pdf' && response.body) {
      // The last case exercises a body stream rejection.
      if (response.headers.get('content-length') === 'never') assert.fail();
    }
    const f = fixture(t, async url => url.includes('/check/') ? consent(active) : response);
    await f.attempt.done;
    // The complete valid fixture is also a positive control.
    assert.equal(f.states.at(-1).status, response.headers.get('content-type') === 'application/pdf' && f.blobs.length ? 'ready' : 'error');
  }
  const response = documentResponse(); response.blob = async () => { throw Error('private'); };
  const f = fixture(t, async url => url.includes('/check/') ? consent(active) : response);
  await f.attempt.done;
  assert.match(f.states.at(-1).error, /interrupted/);
});
test('diagnostics are strictly bounded safe fields without token, identity, URL or content', async t => {
  const f = fixture(t, async url => url.includes('/check/') ? consent(active) : documentResponse());
  await f.attempt.done; f.attempt.close();
  for (const event of f.events) assert.deepEqual(Object.keys(event).sort(), ['category', 'closed', 'durationMs', 'httpStatus', 'operation']);
  assert.doesNotMatch(JSON.stringify(f.events), /synthetic-secret|synthetic-patient|synthetic-record|fixture.invalid|PDF/);
});
