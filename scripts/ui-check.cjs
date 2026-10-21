// Browser checks use synthetic fixtures only; no real wallet or backend mutations.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { ethers } = require('../frontend/node_modules/ethers');
const root = path.resolve(__dirname, '..');
const patient = ethers.Wallet.createRandom();
const doctor = ethers.Wallet.createRandom();
const fixtures = Array.from({ length: 14 }, (_, i) => ({ id: 'fixture-' + i, source: i % 2 ? 'backend' : 'blockchain', action: i % 2 ? 'RecordServed' : 'AccessGranted', actor: patient.address, patient: patient.address, doctor: doctor.address, timestamp: '2026-10-10T08:00:00.000Z', outcome: i % 2 ? 'response-sent' : 'included', blockNumber: 100, confirmations: 3, transactionHash: '0x' + '11'.repeat(32) }));
fixtures.forEach((event, index) => { event.transactionStatus = index === 2 ? 'unknown' : 'success'; });
fixtures[4].transactionHash = 'invalid-hash';

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(root, 'frontend/node_modules/vite/dist/node/index.js')));
  const vite = await createServer({ root: path.join(root, 'frontend'), server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const failures = [];
  try {
    for (const width of [360, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.exposeFunction('testSign', message => patient.signMessage(ethers.getBytes(message)));
      await page.addInitScript(address => {
        const listeners = new Map();
        window.__testAccess = false;
        window.__testWalletEvent = name => { for (const callback of listeners.get(name) || []) callback(); };
        window.ethereum = { on(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]); }, removeListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback)); }, request: async ({ method, params }) => {
          if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [address];
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'personal_sign') return window.testSign(params[0]);
          if (method === 'eth_call') return '0x' + '0'.repeat(63) + (window.__testAccess ? '1' : '0');
          throw new Error('Unexpected test wallet method: ' + method);
        } };
      }, patient.address);
      let auditFailure = false;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname.includes('google')) return route.abort();
        let data;
        if (url.pathname.startsWith('/auth/nonce/')) data = { nonce: 'fixture-nonce', message: 'HealthVault test challenge', patientId: 'HV-TEST' };
        else if (url.pathname === '/auth/verify') data = { token: 'synthetic-test-token', address: patient.address, patientId: 'HV-TEST' };
        else if (url.pathname === '/records/patient') data = { records: [] };
        else if (url.pathname.startsWith('/appointments/')) data = { appointments: [] };
        else if (url.pathname === '/consent/requests') data = { requests: [] };
        else if (url.pathname === '/audit') {
          if (auditFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic service outage' }) });
          data = { events: fixtures, warnings: [], coverage: { fromBlock: 0, toBlock: 102, latestBlock: 102, nextToBlock: null } };
        }
        if (data) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        return route.continue();
      });
      for (const role of ['Patient', 'Care provider', 'System admin']) {
        await page.goto(vite.resolvedUrls.local[0]);
        await page.getByRole('button', { name: 'Back to app' }).click();
        await page.getByRole('button', { name: new RegExp(role) }).click();
        await page.getByRole('button', { name: 'Continue with MetaMask' }).click();
        await page.locator('.workspace-main').waitFor();
        await page.waitForTimeout(250);
        if (role === 'Care provider') {
          await page.getByLabel('Patient ID or wallet address').fill(doctor.address);
          await page.getByRole('button', { name: 'Find Patient', exact: true }).click();
          await page.getByText(/No access — patient has not approved yet/).waitFor();
          await page.evaluate(() => { window.__testAccess = true; });
          await page.getByRole('button', { name: /Encrypt and Upload to Blockchain/ }).waitFor();
          await page.evaluate(() => { window.__testAccess = false; });
          await page.getByRole('button', { name: /Encrypt and Upload to Blockchain/ }).waitFor({ state: 'hidden' });
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (overflow) failures.push(`${role} overview overflows at ${width}px`);
        if (width < 761) await page.getByRole('button', { name: 'Menu' }).click();
        await page.getByRole('link', { name: 'Audit dashboard' }).click();
        await page.locator('.audit-entry').first().waitFor();
        if (await page.locator('.audit-entry').count() !== 10) failures.push('Pagination page size');
        await page.getByText('Transaction status not verified', { exact: true }).waitFor();
        await page.getByText('Transaction hash unavailable', { exact: true }).waitFor();
        if (await page.locator('.audit-transaction a').count() !== 4) failures.push('Only valid blockchain hashes should have links');
        const transactionLink = page.locator('.audit-transaction a').first();
        if (await transactionLink.getAttribute('href') !== 'https://sepolia.etherscan.io/tx/' + '0x' + '11'.repeat(32)) failures.push('Sepolia transaction link');
        if (!(await transactionLink.innerText()).includes('0x1111…1111')) failures.push('Visible shortened transaction hash');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        if (await page.locator('.audit-entry').count() !== 4) failures.push('Second page size');
        await page.getByRole('button', { name: 'Previous', exact: true }).click();
        await page.getByLabel('Wallet address', { exact: true }).fill('0xnotawallet');
        await page.getByText('No matching events', { exact: true }).waitFor();
        await page.getByLabel('Wallet address', { exact: true }).fill(doctor.address.toUpperCase());
        if (await page.locator('.audit-entry').count() !== 10) failures.push('Wallet filtering');
        await page.getByLabel('Wallet address', { exact: true }).fill('');
        await page.getByLabel('Action', { exact: true }).selectOption('AccessGranted');
        if (await page.locator('.audit-entry').count() !== 7) failures.push('Action filtering');
        await page.getByLabel('Action', { exact: true }).selectOption('all');
        await page.getByLabel('Date (local)', { exact: true }).fill('2026-10-09');
        await page.getByText('No matching events', { exact: true }).waitFor();
        await page.getByLabel('Date (local)', { exact: true }).fill('');
        await page.getByLabel('Search', { exact: true }).fill('no-match');
        await page.getByText('No matching events', { exact: true }).waitFor();
        await page.getByLabel('Search', { exact: true }).fill('');
        await page.getByLabel('Source', { exact: true }).selectOption('backend');
        if (await page.locator('.audit-entry').count() !== 7) failures.push('Source filtering');
        await page.getByLabel('Source', { exact: true }).selectOption('all');
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) failures.push(`${role} audit overflows at ${width}px`);
        if (role === 'Patient') {
          fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: path.join(root, `test-results/audit-${width}.png`), fullPage: true });
          auditFailure = true;
          await page.getByRole('button', { name: 'Refresh latest' }).click();
          await page.getByRole('alert').filter({ hasText: 'Synthetic service outage' }).waitFor();
          await page.getByText('Showing the previously loaded snapshot. The latest request failed.').waitFor();
          auditFailure = false;
          await page.getByRole('button', { name: 'Refresh latest' }).click();
          await page.getByRole('button', { name: 'Refresh latest' }).waitFor();
        }
        if (width === 1280 && role === 'System admin') {
          await page.evaluate(() => window.__testWalletEvent('accountsChanged'));
          await page.getByText(/Your wallet or network changed/).waitFor();
          if (await page.evaluate(() => localStorage.getItem('healthvault_token'))) failures.push('Wallet change did not clear session');
        } else {
          if (width < 761) await page.getByRole('button', { name: 'Menu' }).click();
          await page.getByRole('button', { name: 'Sign out' }).click();
        }
      }
      failures.push(...errors);
      await context.close();
      console.log(`Checked patient, doctor, admin, audit filters, API failure/retry, navigation and sign-out at ${width}px.`);
    }
    if (failures.length) throw Error(failures.join('\n'));
    console.log('Browser checks passed: 9 role/viewport combinations. Fixtures were used; no live transactions.');
  } finally { await browser.close(); await vite.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
