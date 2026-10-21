import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { consentPresentation } from '../src/lib/consentUi.js';
import { walletContract } from '../src/lib/blockchain.js';

const now = Date.parse('2026-10-13T12:00:00Z');
const active = seconds => ({ status: 'active', hasAccess: true, expiresAt: new Date(now + seconds * 1000).toISOString() });

test('consistent consent states; missing and unknown verification never imply access', () => {
  assert.equal(consentPresentation(null, now).label, 'Checking');
  for (const [status, label] of Object.entries({ active: 'Active', expired: 'Expired', revoked: 'Revoked', none: 'No access granted', 'verification-unavailable': 'Unable to Verify' })) {
    assert.equal(consentPresentation({ status }, now).label, label);
  }
  assert.equal(consentPresentation({ status: 'unexpected' }, now).label, 'Unable to Verify');
  assert.equal(consentPresentation({ ...active(30), hasAccess: false }, now).label, 'Unable to Verify');
});

test('countdown boundaries, subtle warning, expiry and revocation', () => {
  assert.equal(consentPresentation(active(900), now).countdown, '15:00 remaining');
  assert.equal(consentPresentation(active(60), now).endingSoon, false);
  assert.equal(consentPresentation(active(59), now).endingSoon, true);
  assert.equal(consentPresentation(active(1), now).countdown, '0:01 remaining');
  for (const seconds of [0, -1]) {
    const view = consentPresentation(active(seconds), now);
    assert.equal(view.label, 'Expired');
    assert.equal(view.countdown, null);
    assert.equal(view.endingSoon, false);
  }
  for (const status of ['revoked', 'verification-unavailable']) {
    assert.equal(consentPresentation({ ...active(30), status }, now).countdown, null);
  }
  assert.equal(consentPresentation({ status: 'active', expiresAt: 'invalid' }, now).countdown, null);
  assert.equal(consentPresentation({ status: 'active' }, now).countdown, null);
});

const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');
function handler(name, parameters, dependencies) {
  const match = source.match(new RegExp(`const ${name} = async \\(${parameters}\\) => \\{([\\s\\S]*?)\\n  \\};`));
  assert.ok(match, `${name} handler found`);
  return new Function(...Object.keys(dependencies), `return async (${parameters}) => {${match[1]}}`)(...Object.values(dependencies));
}

test('revoke confirmation identifies resolved wallet; cancel makes no transaction or API call', async () => {
  const wallet = '0x00000000000000000000000000000000000000ab';
  for (const confirmed of [false, true]) {
    const events = [];
    const messages = [];
    const revoke = handler('revokeAccess', 'targetDoctor', {
      doctorInput: 'HV-1002', notify: () => assert.fail('unexpected notification'),
      setLoading: value => events.push(value ? 'busy' : 'idle'),
      setMessage: message => messages.push(message), setCheckResult: () => {},
      resolveDoctorAddress: async input => { assert.equal(input, 'HV-1002'); return wallet; },
      window: { confirm: message => { assert.ok(message.includes(wallet)); events.push('confirm'); return confirmed; } },
      getContract: async () => { events.push('wallet'); return { revokeAccess: async address => { assert.equal(address, wallet); events.push('transaction'); return 'tx'; } }; },
      waitForSuccess: async tx => { assert.equal(tx, 'tx'); events.push('receipt'); },
      apiRequest: async (url, options) => { assert.equal(url, '/consent/revoke'); assert.equal(JSON.parse(options.body).doctorAddress, wallet); events.push('sync'); },
      setTimeout: callback => callback(),
      ethers: { BrowserProvider: class {}, Contract: class { async hasAccess() { events.push('verify'); return false; } } },
      CONTRACT_ADDRESS: 'contract', CONTRACT_ABI: [], account: 'patient',
      setDoctorInput: () => {}, fetchGrants: () => events.push('refresh'), transactionError: error => error.message,
    });
    await revoke();
    assert.deepEqual(events, confirmed
      ? ['busy', 'confirm', 'wallet', 'transaction', 'receipt', 'sync', 'verify', 'refresh', 'idle']
      : ['busy', 'confirm', 'idle']);
    assert.equal(messages.some(message => message?.type === 'success'), confirmed);
  }
});

test('request approval reports success only after receipt and backend sync; rejection and failures stay honest', async () => {
  for (const scenario of ['success', 'cancelled', 'receipt-failure', 'sync-failure', 'reject']) {
    const events = [];
    const messages = [];
    const respond = handler('respondToRequest', 'requestId, action, doctorAddr', {
      getContract: async () => ({ grantAccess: async () => { events.push('transaction'); if (scenario === 'cancelled') throw Error('cancelled'); return 'tx'; } }),
      waitForSuccess: async () => { events.push('receipt'); if (scenario === 'receipt-failure') throw Error('failed'); },
      apiRequest: async () => { events.push('sync'); assert.equal(messages.some(m => m?.type === 'success'), false); if (scenario === 'sync-failure') throw Error('sync failed'); },
      localStorage: { getItem: () => 'test-token' }, setLoading: () => {},
      setMessage: message => messages.push(message), setPendingRequests: () => events.push('remove'), transactionError: error => error.message,
    });
    await respond('request', scenario === 'reject' ? 'reject' : 'accept', '0xdoctor');
    assert.deepEqual(events, {
      success: ['transaction', 'receipt', 'sync', 'remove'], cancelled: ['transaction'],
      'receipt-failure': ['transaction', 'receipt'], 'sync-failure': ['transaction', 'receipt', 'sync'], reject: ['sync', 'remove'],
    }[scenario]);
    assert.equal(messages.at(-1).type, ['success', 'reject'].includes(scenario) ? 'success' : 'error');
  }
});

test('request approval uses its displayed duration, independently of the manual grant selector', async () => {
  for (const duration of [undefined, 5, 15, 30, 60]) {
    let submitted;
    const respond = handler('respondToRequest', 'requestId, action, doctorAddr', {
      requestDurations: duration ? { request: duration } : {}, selectedDuration: 60,
      getContract: async () => ({ grantAccess: async () => 'tx' }), waitForSuccess: async () => {},
      apiRequest: async (_url, options) => { submitted = JSON.parse(options.body); },
      localStorage: { getItem: () => 'test-token' }, setLoading: () => {}, setMessage: () => {},
      setPendingRequests: () => {}, transactionError: error => error.message,
    });
    await respond('request', 'accept', '0xdoctor');
    assert.equal(submitted.durationMinutes, duration || 15);
  }
});

test('manual grants preserve resolved wallet and receipt-before-sync ordering on success and failure', async () => {
  const wallet = '0x00000000000000000000000000000000000000ab';
  for (const scenario of ['success', 'wallet-mismatch', 'cancelled', 'receipt-failure', 'sync-failure']) {
    const events = [], messages = [];
    const grant = handler('grantAccess', '', {
      doctorInput: 'HV-1002', selectedDuration: 5, account: 'patient',
      notify: () => assert.fail('Unexpected notification'), setLoading: () => {}, setCheckResult: () => {},
      setMessage: message => messages.push(message),
      resolveDoctorAddress: async () => wallet,
      getContract: async () => {
        events.push('wallet');
        if (scenario === 'wallet-mismatch') throw Error('wallet changed');
        return { grantAccess: async address => {
          assert.equal(address, wallet); events.push('transaction');
          if (scenario === 'cancelled') throw Error('cancelled');
          return 'tx';
        } };
      },
      waitForSuccess: async () => { events.push('receipt'); if (scenario === 'receipt-failure') throw Error('reverted'); },
      apiRequest: async (url, options) => {
        events.push('sync'); assert.equal(url, '/consent/grant');
        assert.deepEqual(JSON.parse(options.body), { doctorAddress: wallet, durationMinutes: 5 });
        assert.equal(messages.some(message => message?.type === 'success'), false);
        if (scenario === 'sync-failure') throw Error('offline');
        return { grant: active(300) };
      },
      setTimeout: callback => callback(), window: { ethereum: {} },
      ethers: { BrowserProvider: class {}, Contract: class { async hasAccess(patient, doctor) {
        assert.equal(patient, 'patient'); assert.equal(doctor, wallet); events.push('verify'); return true;
      } } },
      CONTRACT_ADDRESS: 'contract', CONTRACT_ABI: [], setDoctorInput: () => {},
      fetchGrants: () => events.push('refresh'), transactionError: error => error.message,
    });
    await grant();
    assert.deepEqual(events, {
      success: ['wallet', 'transaction', 'receipt', 'sync', 'verify', 'refresh'],
      'wallet-mismatch': ['wallet'], cancelled: ['wallet', 'transaction'],
      'receipt-failure': ['wallet', 'transaction', 'receipt'], 'sync-failure': ['wallet', 'transaction', 'receipt', 'sync'],
    }[scenario]);
    assert.equal(messages.at(-1).type, scenario === 'success' ? 'success' : 'error');
  }
});

test('wallet binding rejects a changed MetaMask account without sending a transaction', async t => {
  const previousWindow = globalThis.window;
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  globalThis.window = { ethereum: { request: async ({ method }) => {
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_accounts') return ['0x00000000000000000000000000000000000000ab'];
    assert.fail(`Unexpected wallet method: ${method}`);
  } } };
  await assert.rejects(walletContract([], '0x0000000000000000000000000000000000000001'), /wallet account changed/);
});
