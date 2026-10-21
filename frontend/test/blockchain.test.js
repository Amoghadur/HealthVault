import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForSuccess, transactionError, assertSepolia } from '../src/lib/blockchain.js';

test('transaction cancellation and reverted receipts are never successful', async () => {
  await assert.rejects(waitForSuccess({ wait: async () => { throw Object.assign(Error('cancel'), { code: 'ACTION_REJECTED' }); } }));
  await assert.rejects(waitForSuccess({ wait: async () => ({ status: 0 }) }));
  await assert.rejects(waitForSuccess({ wait: async () => null }));
  assert.match(transactionError({ code: 4001 }), /cancelled/);
  assert.match(transactionError({ code: 'CALL_EXCEPTION' }), /failed/);
});
test('successful and repriced transactions use the actual receipt', async () => {
  const receipt = { status: 1, hash: 'replacement' };
  assert.equal(await waitForSuccess({ wait: async () => receipt }), receipt);
  assert.equal(await waitForSuccess({ wait: async () => { throw { code: 'TRANSACTION_REPLACED', cancelled: false, receipt }; } }), receipt);
  await assert.rejects(waitForSuccess({ wait: async () => { throw { code: 'TRANSACTION_REPLACED', cancelled: true, receipt }; } }));
});
test('wrong chain is rejected', async () => {
  await assert.rejects(assertSepolia({ getNetwork: async () => ({ chainId: 1n }) }));
  await assertSepolia({ getNetwork: async () => ({ chainId: 11155111n }) });
});
