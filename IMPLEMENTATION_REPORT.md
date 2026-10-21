# HealthVault implementation report

Completed 10 October 2026. No Sepolia transaction or deployment was submitted.

## Preserved and verified

- Frontend, backend, and contracts `.env` files were not edited. Hash comparisons against the pre-change backup passed.
- Solidity source, Hardhat configuration, and compiled contract artifact are unchanged.
- Configured address: `0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39` on Sepolia, chain ID `11155111`.
- A read-only RPC check confirmed deployed runtime bytecode exactly matches the existing artifact. Existing function ABIs were preserved; the audit reader imports the artifact's existing event definitions.
- Deployment was located at block `11861935`. The live audit reader decoded one genuine `RecordUploaded` event in each of the windows `11875710–11875809` and `11882901–11883000`. These are observed windows, not all-time totals.
- Contract events remain `RecordUploaded`, `AccessGranted`, and `AccessRevoked`. The contract emits no record-view event.
- The generated backup is under `.backups/healthvault-2026-10-10T08-11-43-145Z/`. It includes 56 hash-verified files, including private configuration and stored files. Dependencies and download caches were excluded. The backup is ignored by Git and is outside the web-served directory.

## Stage 1 — audit and dashboard

The new authenticated `GET /audit` returns only activity involving the JWT wallet. Selecting the admin UI does not grant access to other wallets' server activity.

Blockchain entries use real logs, transaction senders, block timestamps, block hashes, transaction hashes, and confirmation counts at fetch time. Removed logs are omitted; mismatched block hashes cause the read to fail instead of mixing data across a reorganization. RPC errors produce explicit incomplete-history warnings.

The initial scan covers 200 recent blocks. Users can load older windows or enter an ending block. Explicit API ranges are limited to 2,000 blocks. RPC range-limit errors are split into smaller requests. The configured provider rejected a full-history query; the bounded reader passed live integration checks. This dashboard does not imply that a loaded window is complete lifetime history. Refresh latest replaces the loaded blockchain snapshot; load older extends it.

Backend actions append to `backend/data/audit.jsonl` outside public uploads. Fields are allowlisted: no signatures, tokens, encryption keys, QR tokens, or medical content. Entries distinguish local storage, file-response completion, rejection, consent requests/responses, and emergency QR activity. Backend logs begin when this implementation is used; old activity is not reconstructed. Backend files are not an immutable audit ledger.

The responsive audit UI includes source/action/date/search filters, pagination, loading, errors, retry, empty states, and transaction links. Statistics count loaded events only. Hardcoded audit rows and admin metrics were removed. Existing example records/profiles remain available and explicitly labelled as demonstrations. Mobile navigation and sign-out are accessible. Shared controls have focus states and inline feedback. Wallet/network changes clear the old session.

Workflow corrections:

- Accepting a request now waits for a successful grant receipt before acknowledging acceptance to the existing backend endpoint.
- Failed/cancelled `uploadRecordFor` calls no longer fall back to `uploadRecord`, which would associate the hash with the doctor rather than the intended patient.
- Receipt status is checked; replacement/cancellation errors are not treated as successful transactions.
- Upload UI explains that a local record can exist before or without blockchain confirmation.
- Patient ID returned by login is saved instead of displaying the old fallback ID.
- QR hiding is labelled accurately: hiding does not revoke the token.

Existing files changed:

- `backend/server.js`
- `backend/routes/records.js`
- `backend/routes/consent.js`
- `backend/package.json`
- `frontend/src/App.jsx`
- `frontend/src/Dashboard.jsx`
- `frontend/src/PatientView.jsx`
- `frontend/src/DoctorView.jsx`
- `frontend/src/AdminView.jsx`
- `frontend/src/AboutPage.jsx`
- `frontend/src/index.css`
- `frontend/index.html`
- `frontend/package.json`

Files added:

- `backend/routes/audit.js`
- `backend/services/auditStore.js`
- `backend/services/blockchain.js`
- `backend/test/audit.test.js`
- `frontend/src/components/AuditDashboard.jsx`
- `frontend/src/components/ui.jsx`
- `frontend/src/lib/api.js`
- `frontend/src/lib/blockchain.js`
- `frontend/test/blockchain.test.js`
- `contracts/test/HealthVault.compatibility.cjs`
- `scripts/ui-check.cjs`
- `scripts/verify-audit.cjs`
- `.gitignore`
- `backend/.gitignore`

Stage gate: 5 backend tests, 3 frontend tests, 1 local contract test, frontend lint/build, and 9 role/viewport browser combinations passed.

## Stage 2 — authentication replay protection

The previous flow generated a nonce but signed a constant wallet message. A previously captured signature could satisfy a newly requested nonce.

The server now generates a cryptographically random 32-byte nonce, a five-minute expiry, and the exact message to sign. The message includes the intended wallet, application origin, chain ID, nonce, issuance time, and expiry. A new challenge invalidates the previous challenge for that wallet. Signature verification and consumption are synchronous; only one concurrent request can succeed. Restarting the process invalidates outstanding challenges. Expired challenges are removed and outstanding storage is bounded.

Endpoint compatibility: `GET /auth/nonce/:address` adds `message` and `expiresAt` while preserving `nonce` and `patientId`. `POST /auth/verify` still accepts `{ address, signature }` and returns the existing JWT fields. The frontend must sign `message` from the nonce response. Old constant-message signatures are intentionally rejected. Existing JWT expiry remains 24 hours; this does not introduce role privileges.

Files changed: `backend/routes/auth.js`, `frontend/src/App.jsx`.

Files added: `backend/services/authChallenges.js`, `backend/test/auth.test.js`.

Stage gate: all 9 backend tests passed, including replay after reissuing a nonce, expiry, wrong wallet, changed chain/application text, legacy signatures, and parallel verification. Frontend tests, lint and build passed.

## Stage 3 — appointment authorization

The old appointment record only contained a doctor display name. Any authenticated wallet could list and confirm every appointment.

Booking now requires `doctorAddress`, resolved in the frontend from a wallet address or HealthVault ID. Doctor names remain display labels, not proof of clinician identity. Patient address and ID come from the JWT, not caller-supplied identity fields. Only the assigned wallet can list the doctor's bookings or confirm a booking. Repeated confirmation preserves the original confirmation time. Patients continue to see their own bookings. Booking and confirmation use the existing endpoint names and response fields, with `doctorAddress` added to records.

The required doctor wallet is an intentional request-validation change: a name alone cannot establish authorization. There is no verified clinician registry in this project, and this change does not pretend otherwise.

Appointments now persist in `backend/data/appointments.json`. Existing in-memory appointments from a previous process cannot be recovered from disk; unassigned legacy records are never silently assigned to a doctor. Existing users should rebook such requests with the intended wallet after restarting.

Files changed: `backend/routes/appointments.js`, `frontend/src/PatientView.jsx`, `frontend/src/DoctorView.jsx`.

Files added: `backend/services/appointmentStore.js`, `backend/test/appointments.test.js`.

Stage gate: all 10 backend tests passed. Appointment checks cover JWT identity binding, missing recipients, malformed dates, unauthenticated requests, unrelated-wallet listing/confirmation, patient confirmation attempts, legitimate confirmation, persistence, idempotence, legacy records, and corrupt storage. Frontend tests, lint and build passed.

## Record storage protections from the approved plan

Backend uploads now require patient ownership or current on-chain consent. Revoked/unauthorized doctor uploads return 403; network verification failures return 503 and fail closed. Rejected multipart uploads have their temporary plaintext file removed. Existing authorized upload requests and response fields are unchanged.

The public `/files` mount serves only encrypted-blob filenames. It no longer serves `records_metadata.json`, which contains encryption keys. Encrypted blob compatibility URLs remain available. Patient decrypted PDF viewing still uses its existing ownership-checked endpoint.

Files changed: `backend/server.js`, `backend/routes/records.js`, `backend/services/blockchain.js`, `backend/services/auditStore.js`, `frontend/src/components/AuditDashboard.jsx`.

Files added: `backend/middleware/recordAccess.js`, `backend/test/recordAccess.test.js`.

Stage gate: all 12 backend tests passed, including revoked access, failed consent verification, cleanup, and encoded metadata-path rejection.

## Final verification and commands

| Check | Result |
| --- | --- |
| Backend `npm test` | 12 tests passed |
| Frontend `npm test` | 3 tests passed |
| Frontend `npm run lint` | Passed |
| Frontend `npm run build` | Passed; approximately 530 kB main chunk triggers a non-fatal Vite size warning |
| Backend `node --check` | Passed for 12 source files; no backend build script exists |
| Contracts `npx hardhat test --no-compile --network hardhat` | 1 passing local-only compatibility test covering upload/grant/revoke events, consent reads and revoked access/uploads |
| Browser `node scripts/ui-check.cjs` | 9 role/viewport combinations at 360, 768 and 1280 px; filters, pagination, API failure/retry, mobile navigation/sign-out, consent revocation and wallet-change session reset passed |
| Read-only `node scripts/verify-audit.cjs` | Two genuine existing Sepolia upload events decoded in bounded windows |
| Protected-file comparison | `.env` files, contract source/config/artifact unchanged |

The browser script uses Playwright (`PLAYWRIGHT_MODULE_PATH` may point to an installed Playwright package) and installed Chrome. It creates its own temporary Vite server and synthetic API/wallet fixtures. Screenshots under `test-results/` contain test fixtures, not live patient records or actual audit statistics. Transaction cancellation/failure cases use injected errors/receipts; contract enforcement uses a local Hardhat chain. No live MetaMask transaction was manually approved or sent.

Initial failures and resolution:

- Sandbox DNS blocked the read-only RPC check; it passed with network permission.
- Sandbox restrictions blocked loopback HTTP tests and the Hardhat cache directory; permitted reruns passed.
- Two new lint issues were corrected (unused catch binding and missing error cause).
- A browser check found an ambiguous audit select label; explicit accessible names corrected it.
- The provider rejected a full-range history query. Bounded-window reads are deliberate, visible in the UI, and passed live checks.

## Operation and remaining limits

Restart the backend and frontend together so the new challenge-signing flow is used by both. Existing users can sign out and reconnect. Data directories are created on the first real write; tests use temporary stores and do not seed application audit history.

The existing Pinata helper can still return a synthetic identifier when Pinata fails. That behavior was not replaced; the UI no longer treats a server response as independent proof of IPFS availability, and blockchain audit entries only prove that the contract emitted an event. Existing sample patient profiles and example records remain demonstrations. Doctor PDF retrieval is still not a feature of the original app; this change does not invent record-view events for it. Backend JSON storage assumes one server process. Nonces, consent requests, QR tokens and the existing dynamic patient-ID registry remain process-local. Hiding a QR does not invalidate it server-side. Public encrypted blobs cannot be recalled once downloaded, and local record deletion does not erase a blockchain hash or unpin IPFS content.

`frontend/dist/` was regenerated by the production build. This report is the final additional file, `IMPLEMENTATION_REPORT.md`.
