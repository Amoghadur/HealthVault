# Audit dashboard — implementation and verification

Updated 10 October 2026. This pass extends the audit implementation already present in the project. Earlier implementation work is recorded in [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md).

## What the dashboard displays

- Existing Sepolia `RecordUploaded`, `AccessGranted`, and `AccessRevoked` events from the unchanged contract at `0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39`, chain ID `11155111`. The reader checks the deployed runtime against the existing compiled artifact before reading events.
- Event timestamps come from their blocks. Upload actors come from transaction senders. Grant/revoke actors come from the contract's patient argument. Medical hashes/content are not included in audit API results.
- Successful transaction status requires a receipt with status `1` and matching transaction hash, block hash, and block number. Missing/unavailable receipts show “Transaction status not verified.” Inconsistent or reverted receipts reject that blockchain read. Receipt requests are deduplicated within each read.
- Shortened wallet addresses and transaction hashes have full-value tooltips. Only a valid 32-byte on-chain transaction hash produces a Sepolia Etherscan link.
- Backend events remain separately labelled server activity. `RecordServed` means the server finished sending a response; it does not establish that someone opened/read a document. No record-view event exists in the contract.
- Searches and wallet/action/source/local-date filters apply to loaded history. Counts describe loaded events, never lifetime totals. The initial blockchain window is 200 blocks; historical windows and “Load older” expose older history. Refresh latest replaces the loaded snapshot.
- Loading, partial-source warnings, request errors, empty results, and pagination remain available. A failed refresh explicitly labels retained rows as a previously loaded snapshot. Mobile, tablet, and desktop layouts use the existing dashboard styling.

Cancelled/reverted transactions do not retain these contract events. This implementation does not manufacture failed-transaction rows or reconstruct historical backend activity. Confirmations are a snapshot at fetch time, not a guarantee of finality. Server logs remain mutable local storage at `backend/data/audit.jsonl`, outside public uploads.

## Files changed in this pass

| File | Change |
| --- | --- |
| `backend/services/blockchain.js` | Verify matching receipts before reporting transaction success; retain unknown status on receipt outages. |
| `backend/test/audit.test.js` | Receipt success/missing/error/mismatch/revert tests, removed-log handling, receipt deduplication, sensitive hash exclusion. |
| `frontend/src/components/AuditDashboard.jsx` | Explicit transaction hashes/status, safe links, wallet filter, snapshot warning, truthful descriptions/loading counts. |
| `frontend/src/lib/audit.js` | New shared action labels, safe transaction URL construction, local calendar date handling and combined filters. |
| `frontend/src/index.css` | Responsive filter grid and transaction status/link styling. |
| `frontend/test/audit.test.js` | New tests for invalid links, combined filters and local dates. |
| `scripts/ui-check.cjs` | Expanded browser checks for hashes/status, wallet/action/date filters, pagination and retained-snapshot errors. |
| `scripts/verify-audit.cjs` | Read-only receipt verification counts and allowlisted diagnostic messages without RPC secrets. |
| `AUDIT_DASHBOARD.md` | This run guide, change list, results and manual checklist. |

Generated files refreshed by validation:

- `frontend/dist/index.html`
- `frontend/dist/assets/index-IyJIwxhj.css`
- `frontend/dist/assets/index-CxbND6jB.js`
- Previous generated hashed bundles were replaced by Vite.
- `test-results/audit-360.png`
- `test-results/audit-768.png`
- `test-results/audit-1280.png`

Screenshots and browser test data are synthetic test fixtures only; they are not production history. No audit data was seeded into the application.

No package installation, contract/address/ABI changes, deployment, or live transaction was performed. `.env` files, Solidity source, artifact and Hardhat configuration match the existing backup. Authentication, appointments and record workflows were not edited in this pass. Existing API endpoint names and request fields are unchanged; `transactionStatus` is an additive audit response field.

## Run locally

Dependencies are already installed. Keep the existing configuration files intact. Start the backend in one PowerShell terminal:

```powershell
Set-Location 'C:\Users\amogh\Desktop\Major Project\Review 2\Project\backend'
npm start
```

Start the frontend in a second terminal:

```powershell
Set-Location 'C:\Users\amogh\Desktop\Major Project\Review 2\Project\frontend'
npm run dev
```

Open `http://localhost:5173`, connect the intended MetaMask wallet on Sepolia, and select **Audit dashboard**. Use port 5173 because the existing backend CORS configuration allows that frontend origin. Restart existing development servers to pick up backend changes. An empty recent window is normal if the connected wallet has no recent contract activity; enter the end block of a known transaction to find its window.

## Actual verification results

| Check | Result |
| --- | --- |
| Backend `npm test` | 15 passed, 0 failed; includes persistent audit data, scoped API access, receipt failures, replay protection, appointments and revoked upload access. |
| Frontend `npm test` | 6 passed, 0 failed; includes audit filtering/links and transaction cancellation/revert handling. |
| Frontend `npm run lint` | Passed. |
| Frontend `npm run build` | Passed; existing non-fatal bundle warning persists (main JS approximately 531 kB, above 500 kB). |
| Contracts `npx hardhat test --no-compile --network hardhat` | 1 passed on the local network, including upload/grant/revoke events and revoked access. |
| `node scripts/ui-check.cjs` | 9 role/viewport combinations passed: patient, doctor and admin at 360, 768 and 1280 pixels. Tested filters, page navigation, API outage/retry, mobile menus, sign-out, consent UI refresh and wallet-change logout. No horizontal page overflow detected. |
| `node scripts/verify-audit.cjs` | Retry passed against Sepolia. One existing upload event and one matching successful receipt in each window `11875710–11875809` and `11882901–11883000`, at observed head `11885812`. |
| Protected-file comparison | All three `.env` files, contract source, compiled artifact and Hardhat config match backup hashes. |

The initial live RPC check failed without a captured cause. A subsequent read-only retry passed, with no RPC configuration changes; safe operation-stage/error-code diagnostics were added for future failures. The exact initial cause is unresolved, so it is not described as a proven code defect or timeout. All automated local suites passed on their first run in this pass. No real MetaMask cancellation or failed Sepolia transaction was submitted; those paths were tested using controlled receipts/errors and the local chain.

The browser script needs installed Chrome and Playwright. If Playwright is not resolvable as `playwright`, set `PLAYWRIGHT_MODULE_PATH` to the installed Playwright package directory. It starts its own temporary Vite server and intercepts API/wallet traffic. It does not use live patient data.

## Manual test checklist

- [ ] Sign in with a wallet with known Sepolia history. Open Audit dashboard and choose a block window containing that wallet's transaction. Compare action, actor/patient/doctor addresses, hash and block time with Sepolia Etherscan. Browser times are displayed in local time.
- [ ] Exercise an upload, grant and revoke using the existing workflows and test records. After mining, refresh and verify the corresponding on-chain event. An upload records a hash; it does not independently verify file availability. Verify backend actions appear separately.
- [ ] Cancel a MetaMask transaction. Confirm no success message or fabricated chain event appears. A backend upload already completed before cancellation may correctly remain as a separate stored-on-server event.
- [ ] With consent revoked, attempt the existing doctor workflow. Confirm access/upload remains denied and no successful chain upload is claimed. Use local tests for deliberately reverted transactions rather than spending testnet gas unnecessarily.
- [ ] Combine source, action, full/partial wallet, text and local-date filters. Search for a nonmatching value to check the empty state. Clear filters; check Next/Previous without duplicating rows.
- [ ] Check a valid transaction link opens the matching Sepolia transaction. Missing/invalid hashes have no link. Controlled browser tests cover malformed hashes and unknown receipt status; do not edit production audit data to simulate them.
- [ ] Load older blockchain windows, then Refresh latest. Verify the searched block range updates and counts remain labelled as loaded history. An empty range must not imply no earlier activity occurred.
- [ ] Stop the backend and refresh: verify the error and previously loaded snapshot notice. Restart and retry. If the RPC is unavailable, verify blockchain history is labelled unavailable while available backend activity remains separate.
- [ ] Perform an existing action that creates a backend audit entry, restart the backend, and confirm that entry remains. Sign in with an unrelated wallet and confirm private backend entries are absent.
- [ ] At 360, 768 and 1280 pixels, check navigation, filters, long-address tooltips, status text, pagination and keyboard focus. No horizontal page scrolling should be required.
- [ ] Confirm records, encryption keys, signatures, tokens and QR secrets are absent from the audit API/UI. A “Record response sent” event must never be presented as proof a person read the document.
