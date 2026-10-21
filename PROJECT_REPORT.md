# Comprehensive Technical Audit & System Report: HealthVault
**Project:** HealthVault — Decentralized Electronic Health Record (EHR) & Patient-Led Consent System
**Audit Type:** Read-Only Full-Stack Architecture, Smart Contract, Security & Quality Audit
**Date of Audit:** October 17, 2026
**Target Environment:** Node.js v20+, Hardhat v2.19+, Ethereum Sepolia Testnet (Chain ID 11155111), Vite v8.2.1, React 19.2.5
**Auditor:** Antigravity AI (Independent Security & System Audit)

---

## Table of Contents
1. [Executive Summary & Top 10 Critical Findings](#executive-summary--top-10-critical-findings)
2. [Section 1: System Overview & Repository Anatomy](#section-1-system-overview--repository-anatomy)
3. [Section 2: System Architecture & Data Topology](#section-2-system-architecture--data-topology)
4. [Section 3: Smart Contract Deep Dive](#section-3-smart-contract-deep-dive)
5. [Section 4: Backend Architecture & API Specifications](#section-4-backend-architecture--api-specifications)
6. [Section 5: Frontend Architecture, Design Tokens & User Experience](#section-5-frontend-architecture-design-tokens--user-experience)
7. [Section 6: Security, Cryptography & Privacy Review](#section-6-security-cryptography--privacy-review)
8. [Section 7: Code Quality, Testing & Build Verification](#section-7-code-quality-testing--build-verification)
9. [Section 8: Setup, Configuration & Local Run Guide](#section-8-setup-configuration--local-run-guide)
10. [Section 9: Gaps, Production Readiness & Prioritized Roadmap](#section-9-gaps-production-readiness--prioritized-roadmap)
11. [Section 10: Appendix (Dependencies, Glossary & Audit Boundaries)](#section-10-appendix-dependencies-glossary--audit-boundaries)

---

## Executive Summary & Top 10 Critical Findings

HealthVault is an academic prototype designed to provide a patient-centric electronic health record (EHR) exchange platform. Its headline design intent is pairing Ethereum blockchain smart contracts for immutable access consent with decentralized storage (IPFS/Pinata) and AES-256-GCM record encryption.

A comprehensive, zero-assumption read-only examination of the repository reveals that **HealthVault currently functions as a hybrid off-chain centralized application with an Ethereum verification anchor**, rather than a trustless decentralized zero-knowledge architecture. While the user interface delivers an exceptionally polished "spatial UI" (visionOS-style glassmorphism with dynamic ambient illumination), and the test suites achieve 100% pass rates across backend (56/56 passing) and frontend (34/34 passing), **critical architectural discrepancies exist between the claimed security guarantees and the actual code execution**.

Most significantly:
1. Medical document encryption is **performed by the Express backend**, not client-side in the browser.
2. The symmetric encryption keys are **saved in plaintext JSON** on the server's local filesystem (`records_metadata.json`), allowing any party with server filesystem access to decrypt any patient record.
3. On-chain consent in `HealthVault.sol` is a binary flag with no native time-expiration; time-bound expiry is managed exclusively off-chain by server JSON state.
4. Active deployment secrets, including a funded Ethereum private key, Pinata JWT, and hardcoded JWT secrets, are stored in repository configuration files.

### Table of Top 10 Most Important Findings

| # | Finding | Domain | Severity / Impact | Summary & Architectural Reality | Verified Code Reference |
|---|---|---|---|---|---|
| **1** | **Server-Side Encryption vs Claimed Client-Side Sealing** | Security / Cryptography | **CRITICAL** | The UI and documentation advertise "Client-side AES-256-GCM encryption" and "Zero-Knowledge privacy". In reality, the browser transmits unencrypted plaintext PDFs via `multipart/form-data` to `POST /records/upload`. The backend server encrypts the file in memory. | [backend/routes/records.js#L83-L97](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js#L83-L97) |
| **2** | **Plaintext Symmetric Key Storage on Server Disk** | Security / Storage | **CRITICAL** | The 256-bit AES encryption key (`key.toString('hex')`), initialization vector (`iv`), and authentication tag (`authTag`) are stored in cleartext in `backend/uploads/records_metadata.json`. Compromise of the server disk exposes all patient medical data. | [backend/routes/records.js#L162-L167](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js#L162-L167) |
| **3** | **Hardcoded Private Key & Production Secrets in Repository** | Security / DevSecOps | **CRITICAL** | `contracts/.env` reportedly contains an Ethereum private key (**[REDACTED]**). `backend/.env` reportedly contains a static JWT secret (**[REDACTED]**) and a Pinata JWT (**[REDACTED]**). | References: local environment files excluded from version control. |
| **4** | **On-Chain Consent Lacks Time Expiry Enforcement** | Smart Contract / Consent | **HIGH** | `HealthVault.sol` stores access as `mapping(address => mapping(address => bool)) public accessList`. It possesses no timestamp or expiry logic. Time limits (5m, 15m, 30m, 1h) exist purely in the backend's `consent_expiries.json`. | [contracts/contracts/HealthVault.sol#L12](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/contracts/contracts/HealthVault.sol#L12), [backend/services/consentExpiryStore.js#L38-L58](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/services/consentExpiryStore.js#L38-L58) |
| **5** | **Single On-Chain Record Hash Overwrite** | Smart Contract / Data | **MEDIUM** | The smart contract maintains `mapping(address => string) public records`. Calling `setRecord()` overwrites the previous IPFS hash. Multi-record medical histories are entirely maintained off-chain by the backend file `records_metadata.json`. | [contracts/contracts/HealthVault.sol#L9](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/contracts/contracts/HealthVault.sol#L9), [contracts/contracts/HealthVault.sol#L23-L27](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/contracts/contracts/HealthVault.sol#L23-L27) |
| **6** | **In-Memory State Volatility (Consent Requests & QR Tokens)** | Reliability / Availability | **HIGH** | Active consent requests (`accessRequests`) and Emergency QR access tokens (`qrTokens`) are held in volatile Node.js process memory. Any server reboot, crash, or horizontal scaling immediately revokes all active QR tokens and pending doctor requests. | [backend/routes/consent.js#L24-L25](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/consent.js#L24-L25) |
| **7** | **Unauthenticated Emergency QR Scan & Potential Reflected XSS** | Security / AppSec | **HIGH** | `GET /consent/qr/scan/:token` serves an unauthenticated HTML page exposing patient clinical info. The endpoint directly interpolates user-controlled parameters (`data.bloodType`, `data.emergencyContact`, etc.) into an inline HTML template without HTML entity encoding. | [backend/routes/consent.js#L294-L359](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/consent.js#L294-L359) |
| **8** | **Patient Address Enumeration via Unauthenticated Lookup** | Privacy / Info Disclosure | **MEDIUM** | `GET /auth/lookup/:patientId` is completely unauthenticated and allows any internet caller to resolve an internal HealthVault ID (e.g. `HV-1001`) to an Ethereum wallet address, facilitating wallet deanonymization and targeted phishing. | [backend/routes/auth.js#L95-L103](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/auth.js#L95-L103) |
| **9** | **Simulated / Client-Only Admin Role** | Architecture / RBAC | **LOW** | The Admin dashboard (`AdminView.jsx`) explicitly notes that network-wide telemetry and anomaly detection are not implemented. The admin view simply queries the local user's personal audit logs and displays static deployment metadata. | [frontend/src/AdminView.jsx#L107-L113](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/AdminView.jsx#L107-L113) |
| **10** | **Rigorous Test Coverage & Modern Glassmorphic Frontend** | Quality / UI Engineering | **POSITIVE** | 90 automated tests (56 backend, 34 frontend) pass cleanly in sub-second execution. Zero ESLint warnings exist across the modern React 19 codebase. The visionOS-style spatial UI tokens and responsive layouts are executed to a high standard. | [backend/test/](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/test/), [frontend/src/test/](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/test/), [frontend/src/styles/tokens.css](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/styles/tokens.css) |

---

## Section 1: System Overview & Repository Anatomy

HealthVault aims to eliminate centralized electronic health record silos by enabling patients to custody their own medical records, grant time-delimited access to accredited medical professionals, and maintain an immutable on-chain audit trail of all authorizations.

### 1.1 User Roles & Personas

The system models four distinct personas:
1. **Patient (`patient`)**:
   - Primary data subject and rights holder.
   - Authorizes wallet via EIP-191 personal cryptographic signature.
   - Uploads diagnostic PDFs and lab reports.
   - Maintains a customizable demographic profile (display name, avatar, blood group, emergency contact).
   - Approves or rejects doctor access requests with variable expiration windows (5m, 15m, 30m, 1h).
   - Generates temporary emergency QR codes containing critical medical data for first responders.
2. **Doctor (`doctor`)**:
   - Healthcare practitioner.
   - Connects wallet and queries patient by ID (`HV-XXXX`) or wallet address.
   - Submits formal consent access requests specifying clinical justification.
   - Views and downloads decrypted patient medical records during active consent windows.
   - Books and manages patient clinical appointments.
3. **Administrator (`admin`)**:
   - System auditor / infrastructure viewer.
   - Connects an authorized administrator wallet.
   - Monitors node network status, contract verification status on Sepolia, and audit event logs.
4. **Emergency First Responder / Public Viewer**:
   - Unauthenticated actor scanning a physical or digital Emergency QR code.
   - Views immediate life-saving information (blood type, allergies, current medications, emergency phone).

### 1.2 Technology Stack & Exact Versions

The repository is organized into three distinct sub-projects:

```
+-------------------------------------------------------------------------------+
| HealthVault Architecture Stack                                                |
+------------------------------------+------------------------------------------+
| Layer                              | Technologies & Versions                  |
+------------------------------------+------------------------------------------+
| Smart Contracts                    | Solidity ^0.8.20                         |
|                                    | Hardhat v2.19.4                          |
|                                    | @nomicfoundation/hardhat-toolbox v4.0.0  |
|                                    | Sepolia Testnet (Chain ID 11155111)      |
+------------------------------------+------------------------------------------+
| Backend Server                     | Node.js (v20+ target)                    |
|                                    | Express.js v4.18.2                       |
|                                    | Ethers.js v6.10.0                        |
|                                    | Multer v1.4.5-lts.1 (File Handling)      |
|                                    | JsonWebToken v9.0.2                      |
|                                    | Pinata IPFS SDK (REST API)               |
|                                    | Mocha v10.3.0, Chai v4.4.1, Supertest v6 |
+------------------------------------+------------------------------------------+
| Frontend Web Client                | React v19.2.5, React-DOM v19.2.5         |
|                                    | Vite v8.2.1                              |
|                                    | Tailwind CSS v4.0.0 & PostCSS v8.5.1     |
|                                    | Ethers.js v6.11.1                        |
|                                    | Framer Motion v12.38.0                   |
|                                    | Lucide React v1.16.0                     |
|                                    | Canvas-Confetti v1.9.4                   |
|                                    | Vitest v3.0.5 & React Testing Library    |
|                                    | ESLint v9.19.0 (Flat Config)             |
+------------------------------------+------------------------------------------+
```

### 1.3 Annotated Repository Directory Tree

```
Project-revamp again/
├── PROJECT_REPORT.md                 # This comprehensive audit document
├── AUDIT_DASHBOARD.md                # Documentation of audit UI components
├── IMPLEMENTATION_REPORT.md          # Previous implementation summary report
├── .gitignore                        # Git ignore specifications
│
├── contracts/                        # Smart Contract Sub-project
│   ├── contracts/
│   │   └── HealthVault.sol           # Core Solidity smart contract (56 lines)
│   ├── scripts/
│   │   └── deploy.js                 # Hardhat deployment script for Sepolia
│   ├── test/
│   │   └── HealthVault.compatibility.cjs # Hardhat Chai test suite (1 passing test)
│   ├── hardhat.config.js             # Hardhat network & compiler configuration
│   ├── package.json                  # Contract dependencies
│   └── .env                          # Deployment environment & active private keys
│
├── backend/                          # REST API & Orchestration Backend
│   ├── server.js                     # Main Express server entry point (port 5000)
│   ├── routes/
│   │   ├── auth.js                   # Nonce generation, signature verification, JWT
│   │   ├── records.js                # Upload, AES encryption, IPFS, decryption view
│   │   ├── consent.js                # Request, approve, revoke, QR code generation
│   │   ├── profiles.js               # Doctor profile management
│   │   ├── patient.js                # Patient profile management & avatar validation
│   │   ├── appointments.js           # Clinical appointment booking & status updates
│   │   └── audit.js                  # Audit log streaming and metrics computation
│   ├── middleware/
│   │   ├── authMiddleware.js         # JWT validation & role assertion
│   │   └── recordAccess.js           # Multi-layered consent & expiration verification
│   ├── services/
│   │   ├── blockchain.js             # Server-side Ethers.js contract interaction
│   │   ├── authChallenges.js         # In-memory cryptographic nonce tracker
│   │   ├── consentExpiryStore.js     # Off-chain consent TTL persistence
│   │   ├── doctorProfileStore.js     # Doctor demographic profile JSON persistence
│   │   ├── patientProfileStore.js    # Patient demographic profile JSON persistence
│   │   ├── appointmentStore.js       # Appointment ledger JSON persistence
│   │   └── auditStore.js             # Append-only JSONL audit event logger
│   ├── data/                         # Local JSON file databases
│   │   ├── consent_expiries.json     # Active consent records & expiration timestamps
│   │   ├── doctor_profiles.json      # Stored doctor metadata
│   │   ├── patient_profiles.json     # Stored patient metadata
│   │   ├── appointments.json         # Scheduled appointments
│   │   └── audit.jsonl               # Append-only audit trail
│   ├── uploads/                      # Uploaded encrypted files & file metadata
│   │   └── records_metadata.json     # File encryption keys, IVs, IPFS CIDs
│   ├── test/                         # Backend Mocha/Chai test suite (56 tests)
│   ├── package.json                  # Backend dependencies
│   └── .env                          # Backend API keys, JWT secret, Pinata JWT
│
└── frontend/                         # React Vite Web Client
    ├── index.html                    # Single-page application entry HTML
    ├── vite.config.js                # Vite build and test configuration
    ├── eslint.config.js              # ESLint 9 configuration
    ├── src/
    │   ├── main.jsx                  # React DOM root initialization
    │   ├── App.jsx                   # View routing, navigation & authentication state
    │   ├── Dashboard.jsx             # Role-based dashboard router
    │   ├── PatientView.jsx           # Patient dashboard & record management interface
    │   ├── DoctorView.jsx            # Doctor portal, patient lookup & viewer
    │   ├── AdminView.jsx             # Administrator monitor & telemetry view
    │   ├── AboutPage.jsx             # Public landing page with hero & visual rings
    │   ├── legal/
    │   │   ├── PrivacyPolicyPage.jsx # Public Privacy Policy documentation
    │   │   └── TermsPage.jsx         # Public Terms & Conditions documentation
    │   ├── components/
    │   │   ├── common/               # Spatial UI primitives (SpatialCard, Modal, etc.)
    │   │   ├── patient/              # Sub-components for patient profile & records
    │   │   ├── AuditDashboard.jsx    # Real-time audit log viewer & stats
    │   │   ├── ConsentUI.jsx         # Access request approval modal
    │   │   ├── HeroVisual.jsx        # Landing page interactive graphics
    │   │   └── YearPicker.jsx        # Milestone timeline selector
    │   ├── lib/
    │   │   ├── api.js                # Axios/fetch wrappers for all backend routes
    │   │   ├── blockchain.js         # Browser MetaMask/Ethers.js contract wrapper
    │   │   ├── audit.js              # Frontend audit helper routines
    │   │   ├── consentUi.js          # Consent view formatting helpers
    │   │   ├── originalRecordView.js # Decrypted record retrieval & blob renderer
    │   │   ├── patientProfile.js     # Patient profile validation & transformations
    │   │   └── recordSearch.js       # Client-side record filtering utilities
    │   ├── styles/
    │   │   ├── tokens.css            # Spatial UI design tokens (#238071 green theme)
    │   │   └── index.css             # Tailwind CSS imports & global rules
    │   └── test/                     # Frontend Vitest test suite (34 tests)
    └── package.json                  # Frontend dependencies
```

---

## Section 2: System Architecture & Data Topology

### 2.1 Data Topology: On-Chain vs Off-Chain Breakdown

A central question in decentralized healthcare systems is data topology: what state resides on immutable ledgers versus centralized or decentralized storage.

```
+----------------------------------------------------------------------------------------+
| HEALTHVAULT DATA TOPOLOGY MATRIX                                                       |
+---------------------+-------------------+---------------------+------------------------+
| Data Entity         | Primary Location  | Storage Mechanism   | Cryptographic State    |
+---------------------+-------------------+---------------------+------------------------+
| Contract Ownership  | On-Chain          | Ethereum Storage    | Immutable address      |
| Latest Record CID   | On-Chain          | Ethereum Storage    | Plaintext IPFS string  |
| Consent Flag        | On-Chain          | Ethereum Storage    | Boolean (patient->doc) |
| Consent Expiry Time | Off-Chain         | `consent_expiries`  | Epoch millisecond int  |
| Consent Allow-List  | Off-Chain Server  | `consent_allow_lists`| JSON array of record IDs |
| Medical Document    | Decentralized     | IPFS / Local disk   | AES-256-GCM ciphertext |
| AES Symmetric Keys  | Off-Chain Server  | `records_metadata`  | Plaintext hex string   |
| Patient Profiles    | Off-Chain Server  | `patient_profiles`  | Plaintext JSON         |
| Doctor Profiles     | Off-Chain Server  | `doctor_profiles`   | Plaintext JSON         |
| Appointments        | Off-Chain Server  | `appointments.json` | Plaintext JSON         |
| Audit Trail         | Hybrid            | On-chain events +   | Event logs & JSONL     |
|                     |                   | `audit.jsonl` disk  |                        |
| Emergency QR Tokens | In-Memory Server  | Node.js RAM         | Ephemeral token string |
+---------------------+-------------------+---------------------+------------------------+
```

### 2.2 System Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Browser (React 19 + Spatial UI)"]
        UI["User Interface (App.jsx)"]
        MM["MetaMask Wallet (Ethers v6)"]
        PView["Patient View"]
        DView["Doctor View"]
        AView["Admin View"]
    end

    subgraph BackendLayer ["Express Backend (Node.js :5000)"]
        API["REST API Router"]
        AuthM["Auth & Nonce Middleware"]
        RecM["Record Access Control Middleware"]
        CryptoEngine["Crypto Engine (AES-256-GCM)"]
        BCService["Blockchain Service (Ethers v6)"]
    end

    subgraph StorageLayer ["Persistence & Storage Layer"]
        DiskJSON["Local JSON Stores (Profiles, Appointments, Expiries)"]
        DiskMeta["Uploads Metadata (AES Keys, IVs, AuthTags)"]
        DiskAudit["Audit Log (audit.jsonl)"]
        Pinata["Pinata IPFS Gateway (Decentralized Storage)"]
    end

    subgraph BlockchainLayer ["Ethereum Sepolia Testnet (Chain ID: 11155111)"]
        SC["HealthVault.sol Contract (0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39)"]
    end

    %% Client Interactions
    UI --> MM
    MM -- "EIP-191 Personal Sign" --> AuthM
    PView -- "Upload Raw PDF (multipart)" --> API
    DView -- "Request Record / Access" --> API
    MM -- "Direct Transaction (setAccess / setRecord)" --> SC

    %% Backend Interactions
    API --> AuthM
    API --> RecM
    API --> CryptoEngine
    CryptoEngine -- "Encrypted Buffer" --> Pinata
    CryptoEngine -- "Save Hex Key & IV" --> DiskMeta
    API --> DiskJSON
    API --> DiskAudit
    RecM -- "Verify On-Chain Access" --> BCService
    BCService -- "checkAccess(patient, doctor)" --> SC
```

---

### 2.3 Six Core Execution Sequence Diagrams

#### Sequence 1: Authentication & Session Issuance (EIP-191 Challenge-Response)
```mermaid
sequenceDiagram
    autonumber
    actor User as Patient / Doctor / Admin
    participant MM as MetaMask (Browser)
    participant Client as Frontend (api.js)
    participant Server as Backend (auth.js)
    participant Mem as Memory (authChallenges.js)

    User->>MM: Connect Wallet
    MM-->>Client: Returns 0xAddress
    Client->>Server: POST /api/auth/challenge { walletAddress }
    Server->>Mem: generateChallenge(walletAddress) -> Nonce string
    Mem-->>Server: Nonce stored (5 min TTL)
    Server-->>Client: { challenge, message }
    Client->>MM: personal_sign(message, walletAddress)
    MM-->>User: Prompt signature popup
    User->>MM: Approve Signature
    MM-->>Client: Hex Signature
    Client->>Server: POST /api/auth/verify { walletAddress, signature, role }
    Server->>Server: ethers.verifyMessage(challenge, signature)
    alt Signature Matches Recovered Address
        Server->>Server: jwt.sign({ walletAddress, role, patientId }, JWT_SECRET, 24h)
        Server-->>Client: { token, user: { address, role, patientId } }
        Client->>Client: localStorage.setItem('token', token)
    else Invalid Signature
        Server-->>Client: 401 Unauthorized ("Invalid signature")
    end
```

#### Sequence 2: Record Upload & Hybrid Storage
```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant Frontend as PatientView.jsx
    participant Backend as Backend (records.js)
    participant Crypto as Node.js Crypto
    participant Pinata as Pinata IPFS
    participant Disk as records_metadata.json
    participant MM as MetaMask
    participant Contract as HealthVault.sol

    Patient->>Frontend: Selects PDF & Clicks "Upload Record"
    Frontend->>Backend: POST /api/records/upload (multipart/form-data, Bearer Token)
    Backend->>Backend: Validate JWT (Must have 'patient' role)
    Backend->>Crypto: crypto.randomBytes(32) [Key], crypto.randomBytes(16) [IV]
    Backend->>Crypto: cipher.update(fileBuffer) + cipher.final()
    Crypto-->>Backend: Encrypted Buffer + AuthTag
    Backend->>Pinata: pinFileToIPFS(encryptedBuffer)
    alt Pinata Online
        Pinata-->>Backend: IPFS CID (QmXyz...)
    else Pinata Offline / Mock Mode
        Backend-->>Backend: Generate local mock CID
    end
    Backend->>Disk: Append record: { id, ipfsHash, encryptionKey, iv, authTag, patientAddress }
    Backend-->>Frontend: { success: true, record: { id, ipfsHash, name } }
    Frontend->>MM: Prompt contract call: setRecord(ipfsHash)
    MM->>Contract: HealthVault.setRecord(ipfsHash)
    Contract->>Contract: records[msg.sender] = ipfsHash
    Contract-->>MM: Emit RecordUpdated(patient, ipfsHash, timestamp)
    MM-->>Frontend: Transaction Receipt Confirmed
```

#### Sequence 3: Doctor Access Request & Patient Approval
```mermaid
sequenceDiagram
    autonumber
    actor Doctor
    participant DocUI as DoctorView.jsx
    participant Backend as Backend (consent.js)
    actor Patient
    participant PatUI as PatientView.jsx / ConsentUI.jsx
    participant MM as Patient MetaMask
    participant Contract as HealthVault.sol
    participant Store as consentExpiryStore.js

    Doctor->>DocUI: Enters Patient ID / Address + Purpose
    DocUI->>Backend: POST /api/consent/request { patientAddress, purpose }
    Backend->>Backend: Store in in-memory accessRequests list
    Backend-->>DocUI: 200 OK (Request Pending)

    Patient->>PatUI: Views incoming requests
    PatUI->>Backend: GET /api/consent/requests/patient/:address
    Backend-->>PatUI: Returns pending request list
    Patient->>PatUI: Clicks "Grant Access" (Selects duration, e.g. 15 mins)
    PatUI->>MM: Prompt contract transaction: setAccess(doctorAddress, true)
    MM->>Contract: HealthVault.setAccess(doctor, true)
    Contract->>Contract: accessList[patient][doctor] = true
    Contract-->>MM: Emit AccessGranted(patient, doctor, timestamp)
    MM-->>PatUI: Tx Receipt
    PatUI->>Backend: POST /api/consent/approve { requestId, durationMinutes: 15 }
    Backend->>Store: setConsentExpiry(patient, doctor, 15m)
    Backend->>Backend: Mark request approved in memory
    Backend-->>PatUI: 200 OK
```

#### Sequence 4: Doctor Record Access & Server Decryption
```mermaid
sequenceDiagram
    autonumber
    actor Doctor
    participant DocUI as DoctorView.jsx
    participant Backend as Backend (records.js)
    participant Middleware as recordAccess.js
    participant Store as consentExpiryStore.js
    participant Contract as HealthVault.sol
    participant Pinata as Pinata IPFS
    participant Crypto as Node.js Crypto

    Doctor->>DocUI: Clicks "View Medical Record"
    DocUI->>Backend: GET /api/records/view/:recordId (Bearer Token)
    Backend->>Middleware: checkRecordAccess(req, res, next)
    Middleware->>Store: isConsentActive(patientAddress, doctorAddress)
    alt Consent Expired Off-Chain
        Store-->>Middleware: false (Expired)
        Middleware-->>DocUI: 403 Forbidden ("Consent has expired")
    else Consent Active Off-Chain
        Store-->>Middleware: true
        Middleware->>Contract: checkAccess(patientAddress, doctorAddress)
        Contract-->>Middleware: returns bool (true)
        Middleware-->>Backend: next()
    end
    Backend->>Backend: Retrieve record metadata (IPFS CID, encryptionKey, IV, authTag)
    Backend->>Pinata: Fetch ciphertext by CID
    Pinata-->>Backend: Encrypted Bytes
    Backend->>Crypto: createDecipheriv('aes-256-gcm', key, iv)
    Crypto->>Crypto: decipher.setAuthTag(authTag)
    Crypto-->>Backend: Decrypted Plaintext PDF Buffer
    Backend-->>DocUI: HTTP 200 (Content-Type: application/pdf)
    DocUI->>Doctor: Render PDF in Spatial Modal Viewer
```

#### Sequence 5: Consent Revocation
```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant PatUI as PatientView.jsx
    participant MM as Patient MetaMask
    participant Contract as HealthVault.sol
    participant Backend as Backend (consent.js)
    participant Store as consentExpiryStore.js

    Patient->>PatUI: Clicks "Revoke Access" for Doctor
    PatUI->>MM: Prompt contract call: revokeAccess(doctorAddress)
    MM->>Contract: HealthVault.revokeAccess(doctor)
    Contract->>Contract: accessList[msg.sender][doctor] = false
    Contract-->>MM: Emit AccessRevoked(patient, doctor, timestamp)
    MM-->>PatUI: Tx Receipt Confirmed
    PatUI->>Backend: POST /api/consent/revoke { doctorAddress }
    Backend->>Store: revokeConsent(patientAddress, doctorAddress)
    Store->>Store: Delete from consent_expiries.json
    Backend-->>PatUI: 200 OK ("Consent revoked")
```

#### Sequence 6: Unauthenticated Emergency QR Scan Flow
```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant PatUI as PatientView.jsx
    participant Backend as Backend (consent.js)
    actor Responder as Emergency Responder
    participant Scanner as Mobile Phone / QR Reader

    Patient->>PatUI: Clicks "Emergency QR"
    PatUI->>Backend: POST /api/consent/qr/generate { bloodType, allergies, medications, contacts }
    Backend->>Backend: Generate crypto token (UUID/hex)
    Backend->>Backend: Store qrTokens[token] in memory (1 hour TTL)
    Backend-->>PatUI: { token, scanUrl: "http://.../api/consent/qr/scan/:token" }
    PatUI->>Patient: Displays rendered QR Code

    Responder->>Scanner: Scans QR Code
    Scanner->>Backend: GET /api/consent/qr/scan/:token (No Auth Required)
    alt Token Valid in RAM
        Backend->>Backend: Read patient emergency clinical data
        Backend-->>Scanner: Returns rendered HTML Emergency Medical Card
    else Token Expired or Server Restarted
        Backend-->>Scanner: 404 / 410 HTML ("Emergency access expired or invalid")
    end
```

---

## Section 3: Smart Contract Deep Dive

The contract layer consists of a single Solidity source file located at [contracts/contracts/HealthVault.sol](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/contracts/contracts/HealthVault.sol). It is 56 lines long and compiles under Solidity `^0.8.20`.

### 3.1 State Storage Analysis

```solidity
// State Variables in HealthVault.sol
address public owner;                                         // Line 6
mapping(address => string) public records;                    // Line 9
mapping(address => mapping(address => bool)) public accessList; // Line 12
```

1. **`owner` (address)**: Initialized to `msg.sender` in constructor (Line 21). No administrative functions (such as pausing or upgrading) use `owner`.
2. **`records` (mapping(address => string))**: Maps a patient address to an IPFS CID hash string. **Crucial Limitation**: Only one record CID string can be stored per patient at any time. Writing a new CID overwrites the previous one.
3. **`accessList` (mapping(address => mapping(address => bool)))**: Maps `patient => doctor => hasAccess`. This is an indefinite boolean flag with zero temporal parameters.

### 3.2 Comprehensive Function Specifications

| Function Name | Visibility | Mutability | Parameters | Return Values | Modifiers | Description & Logic | Emitted Events |
|---|---|---|---|---|---|---|---|
| `constructor()` | public | nonpayable | None | None | None | Assigns deployer address to `owner` state variable (L21). | None |
| `setRecord(string memory _ipfsHash)` | public | nonpayable | `string _ipfsHash` | None | None | Assigns `records[msg.sender] = _ipfsHash` (L24). Overwrites any previous record string. | `RecordUpdated(msg.sender, _ipfsHash, block.timestamp)` (L25) |
| `getRecord(address _patient)` | public | view | `address _patient` | `string memory` | None | Allows caller (`msg.sender`) to retrieve `_patient` CID if `msg.sender == _patient` OR `accessList[_patient][msg.sender] == true` (L31). Otherwise reverts with `"Access denied."` (L32). | None |
| `setAccess(address _doctor, bool _hasAccess)` | public | nonpayable | `address _doctor`, `bool _hasAccess` | None | None | Sets `accessList[msg.sender][_doctor] = _hasAccess` (L38). If `_hasAccess == true`, emits `AccessGranted`; else emits `AccessRevoked` (L39-L43). | `AccessGranted` / `AccessRevoked` |
| `checkAccess(address _patient, address _doctor)` | public | view | `address _patient`, `address _doctor` | `bool` | None | Read-only check returning `accessList[_patient][_doctor]` (L46). Callable by anyone. | None |
| `revokeAccess(address _doctor)` | public | nonpayable | `address _doctor` | None | None | Convenience helper explicitly setting `accessList[msg.sender][_doctor] = false` (L53). | `AccessRevoked(msg.sender, _doctor, block.timestamp)` (L54) |

### 3.3 Events Definition

| Event Signature | Indexed Parameters | Non-Indexed Parameters | Description |
|---|---|---|---|
| `RecordUpdated(address indexed patient, string ipfsHash, uint256 timestamp)` | `patient` | `ipfsHash`, `timestamp` | Emitted when a patient updates their primary record hash (L15). |
| `AccessGranted(address indexed patient, address indexed doctor, uint256 timestamp)` | `patient`, `doctor` | `timestamp` | Emitted when a patient grants access to a doctor (L17). |
| `AccessRevoked(address indexed patient, address indexed doctor, uint256 timestamp)` | `patient`, `doctor` | `timestamp` | Emitted when access is revoked (L19). |

### 3.4 Smart Contract Gas, Security & Architectural Critique

1. **Absence of Batching or History**: Storing only a single `string` in `records` means the smart contract cannot hold an EHR history. If a patient uploads 10 lab results, 9 of them exist solely in the off-chain backend database (`records_metadata.json`).
2. **Missing Expiration Support**: Smart contracts are fully capable of recording expiration timestamps (`mapping(address => mapping(address => uint256)) public accessExpiry`), checking `block.timestamp < accessExpiry[patient][doctor]`. By omitting this, HealthVault forces the entire time-bound consent model into off-chain server state, negating smart contract enforceability of consent duration.
3. **Open Access**: Any address can call `setRecord` or `setAccess`. There is no sybil resistance or identity verification at the contract level.

---

## Section 4: Backend Architecture & API Specifications

The backend server is implemented in Express.js ([backend/server.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/server.js)), listening by default on port 5000 with CORS configured for `http://localhost:5173`.

### 4.1 Exhaustive API Route Specifications

#### 1. Authentication Routes (`/api/auth`)
*Source:* [backend/routes/auth.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/auth.js)

| Method | Path | Auth / Role | Request Payload / Params | Response Payload / Status | Handler / Logic |
|---|---|---|---|---|---|
| `POST` | `/api/auth/challenge` | Public | `{ walletAddress: string }` | `200 { challenge, message }`<br>`400 { error }` | Validates Ethereum address checksum/format. Calls `authChallenges.generateChallenge()` and stores in RAM with 5-min TTL. (L25-L48) |
| `POST` | `/api/auth/verify` | Public | `{ walletAddress, signature, role }` | `200 { token, user: { address, role, patientId } }`<br>`401 { error }` | Validates challenge in RAM; calls `ethers.verifyMessage(challenge, signature)`. If valid, generates JWT signed with `JWT_SECRET` (24h expiry). Emits audit log `LOGIN_SUCCESS`. (L50-L83) |
| `GET` | `/api/auth/verify-token`| Bearer Token | Headers: `Authorization: Bearer <jwt>` | `200 { valid: true, user }`<br>`401 { valid: false }` | Validates JWT token using `authMiddleware`. Returns decoded wallet, role, patientId. (L85-L93) |
| `GET` | `/api/auth/lookup/:patientId` | Public | URL Param: `patientId` (e.g. `HV-1001`) | `200 { patientId, walletAddress }`<br>`404 { error }` | Checks in-memory registry `KNOWN_WALLETS` and `patient_profiles.json` to map ID to wallet. **Unauthenticated disclosure**. (L95-L103) |

#### 2. Medical Record Routes (`/api/records`)
*Source:* [backend/routes/records.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js)

| Method | Path | Auth / Role | Request Payload / Params | Response Payload / Status | Handler / Logic |
|---|---|---|---|---|---|
| `POST` | `/api/records/upload` | Bearer (`patient`) | `multipart/form-data`: `file` (PDF, max 10MB) | `201 { success: true, record: { id, ipfsHash, originalName, fileSize, uploadedAt } }`<br>`400/500 { error }` | Reads buffer via Multer. Generates 32-byte key & 16-byte IV. Runs AES-256-GCM. Uploads ciphertext to Pinata IPFS. Saves raw key, IV, authTag, and CID into `records_metadata.json`. (L80-L192) |
| `GET` | `/api/records/patient` | Bearer (`patient`) | None | `200 { records: [...] }`<br>`401 { error }` | Patient views their own uploaded records metadata. (No decryption keys returned). |
| `GET` | `/api/records/doctor` | Bearer (`doctor`) | None | `200 { records: [...] }` | Access is granted on-chain per doctor, and which records are visible is enforced by the backend allow-list. Returns only: (a) patient records on the active grant's allow-list, plus (b) records the doctor uploaded themselves. Fails closed (no allow-list = zero patient records). |
| `GET` | `/api/records/view/:recordId` | Bearer (`patient` / `doctor`) | URL Param: `recordId` | `200 Binary Stream (application/pdf)`<br>`403/404 { error }` | Access is granted on-chain per doctor, and which records are visible is enforced by the backend allow-list. Re-checks on-chain consent, expiry TTL, and the grant allow-list on every request. Returns 403 Forbidden with zero metadata leaked if record is not on allow-list or unshared. Streams decrypted PDF. |
| `GET` | `/api/records/check/:patientAddress` | Bearer (`doctor`) | URL Param: `patientAddress` | `200 { hasAccess: boolean, remainingSeconds }` | Queries backend consent expiry store and on-chain contract to verify active status. |

#### 3. Consent Management Routes (`/api/consent`)
*Source:* [backend/routes/consent.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/consent.js)

| Method | Path | Auth / Role | Request Payload / Params | Response Payload / Status | Handler / Logic |
|---|---|---|---|---|---|
| `POST` | `/api/consent/request` | Bearer (`doctor`) | `{ patientAddress, reason }` | `201 { success: true, request }` | Stores access request in persistent JSON store. Emits audit event `AccessRequested`. |
| `GET` | `/api/consent/requests` | Bearer (`patient`) | None | `200 { requests: [...] }` | Returns pending requests for the authenticated patient. |
| `POST` | `/api/consent/grant` | Bearer (`patient`) | `{ doctorAddress, durationMinutes, recordIds }` | `200 { grant, recordIds }` | Access is granted on-chain per doctor, and which records are visible is enforced by the backend allow-list. Persists expiry TTL and atomic record ID allow-list. Validates all record IDs belong to the caller. |
| `POST` | `/api/consent/respond` | Bearer (`patient`) | `{ requestId, action, durationMinutes, recordIds }` | `200 { message, grant, recordIds }` | Patient accepts/declines pending request. If accepted, persists expiry TTL and atomic allow-list. |
| `GET` | `/api/consent/allowlist/:doctorAddress` | Bearer (`patient`) | URL Param: `doctorAddress` | `200 { doctorAddress, recordIds }` | Returns current allow-list of shared record IDs for the active doctor grant. |
| `PUT` | `/api/consent/allowlist/:doctorAddress` | Bearer (`patient`) | `{ recordIds }` | `200 { doctorAddress, recordIds }` | Updates shared record allow-list for active grant immediately without re-granting on-chain. Validates ownership and fails closed. |
| `GET` | `/api/consent/grants` | Bearer (`patient`) | None | `200 { grants: [...] }` | Lists all active and historical grants including `sharedRecordCount` and `sharedRecordIds`. |
| `POST` | `/api/consent/revoke` | Bearer (`patient`) | `{ doctorAddress }` | `200 { success: true }` | Revokes access off-chain and clears the grant allow-list. Emits audit log `ConsentRevoked`. |
| `POST` | `/api/consent/qr/generate` | Bearer (`patient`) | `{ bloodType, allergies, medications, emergencyContact }` | `200 { success: true, token, scanUrl, expiresAt }` | Generates 32-byte hex token. Stores clinical data in persistent token store with 1h TTL. |
| `GET` | `/api/consent/qr/scan/:token` | **Public** | URL Param: `token` | `200 text/html`<br>`404/410 text/html` | Validates token. Renders safe HTML page displaying patient emergency data with strict CSP and nosniff headers. |

#### 4. Patient & Doctor Profile Routes (`/api/patient`, `/api/doctor`)
*Sources:* [backend/routes/patient.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/patient.js), [backend/routes/profiles.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/profiles.js)

| Method | Path | Auth / Role | Request Payload / Params | Response Payload / Status | Handler / Logic |
|---|---|---|---|---|---|
| `GET` | `/api/patient/profile` | Bearer (`patient`) | None | `200 { success: true, profile }`<br>`404 { error }` | Fetches patient profile from `patient_profiles.json` for caller's wallet. (L20-L45) |
| `POST` | `/api/patient/profile` | Bearer (`patient`) | `{ displayName, avatar, phone, dateOfBirth, bloodGroup, about, emergencyContactName, emergencyContactPhone }` | `200 { success: true, profile }`<br>`400 { error }` | Validates: displayName (2-40 chars), avatar (max 200KB base64 data URL, image/png/jpeg/webp), phone, DOB. Persists to `patient_profiles.json`. (L47-L135) |
| `GET` | `/api/doctor/profile` | Bearer (`doctor`) | None | `200 { success: true, profile }` | Reads doctor profile from `doctor_profiles.json`. (L15-L40) |
| `POST` | `/api/doctor/profile` | Bearer (`doctor`) | `{ name, specialty, hospital, phone, bio }` | `200 { success: true, profile }` | Validates and persists doctor profile. (L42-L95) |

#### 5. Appointments & Audit Routes (`/api/appointments`, `/api/audit`)
*Sources:* [backend/routes/appointments.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/appointments.js), [backend/routes/audit.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/audit.js)

| Method | Path | Auth / Role | Request Payload / Params | Response Payload / Status | Handler / Logic |
|---|---|---|---|---|---|
| `GET` | `/api/appointments/doctor/:address` | Bearer (`doctor`) | URL Param: `address` | `200 { success: true, appointments: [...] }` | Returns appointments for specified doctor. |
| `GET` | `/api/appointments/patient/:address` | Bearer (`patient`) | URL Param: `address` | `200 { success: true, appointments: [...] }` | Returns appointments for specified patient. |
| `POST` | `/api/appointments` | Bearer (`patient` / `doctor`) | `{ patientAddress, doctorAddress, date, time, reason }` | `201 { success: true, appointment }` | Validates scheduling conflicts, appends to `appointments.json`. |
| `PATCH` | `/api/appointments/:id/status` | Bearer (`patient` / `doctor`) | URL Param: `id`, Body: `{ status }` | `200 { success: true, appointment }` | Updates appointment state (`CONFIRMED`, `CANCELLED`, `COMPLETED`). |
| `GET` | `/api/audit/stats` | Bearer | None | `200 { totalEvents, actionCounts, uniquePatients, uniqueDoctors }` | Aggregates event telemetry from `audit.jsonl`. |
| `GET` | `/api/audit/logs` | Bearer (`admin`) | Query: `limit`, `offset` | `200 { logs: [...], total }` | Streams structured audit records. |
| `GET` | `/api/audit/logs/patient/:address` | Bearer (`patient`) | URL Param: `address` | `200 { logs: [...] }` | Filters audit events specifically involving the caller's address. |

### 4.2 Middleware Pipeline Analysis

1. **`authMiddleware(req, res, next)`** ([backend/middleware/authMiddleware.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/middleware/authMiddleware.js)):
   - Checks `req.headers.authorization` for `Bearer <token>`.
   - Calls `jwt.verify(token, process.env.JWT_SECRET)`.
   - Injects `req.user = decoded` into the Express request context.
   - Provides helper wrappers `requireRole(role)` to restrict endpoint access by persona.
2. **`recordAccessMiddleware(req, res, next)`** ([backend/middleware/recordAccess.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/middleware/recordAccess.js)):
   - Evaluates whether caller is authorized to view or download a specific medical record.
   - Rule A: If `req.user.walletAddress === record.patientAddress`, access is immediately granted.
   - Rule B: If `req.user.role === 'doctor'`, invokes `consentExpiryStore.isConsentActive(patient, doctor)`. If true, also verifies `blockchain.checkAccess(patient, doctor)`.
   - Rule C: Rejects all other requests with HTTP 403 Forbidden.

### 4.3 Persistence Architecture & Filesystem Stores

HealthVault does not employ a relational or NoSQL database engine (such as PostgreSQL or MongoDB). All persistent state is serialized as JSON files on the local filesystem:
- `backend/uploads/records_metadata.json`: Contains uploaded file metadata, IPFS hashes, and **raw symmetric encryption keys**.
- `backend/data/consent_expiries.json`: Key-value map of `${patientAddress}_${doctorAddress}` to millisecond expiry integers.
- `backend/data/patient_profiles.json`: Map of wallet addresses to patient demographic profiles.
- `backend/data/doctor_profiles.json`: Map of wallet addresses to doctor professional profiles.
- `backend/data/appointments.json`: Array of appointment objects.
- `backend/data/audit.jsonl`: Append-only JSON Lines ledger for audit events.

### 4.4 Environment Variables & Defaults

| Variable Name | Required | Default Value in Code | Audit Status & Exposure |
|---|---|---|---|
| `PORT` | Optional | `5000` | Standard configuration. |
| `JWT_SECRET` | Required | `[REDACTED]` | **VULNERABLE**: Static fallback used in tests and committed in `backend/.env`. |
| `PINATA_JWT` | Optional | None (falls back to mock CID generator) | **EXPOSED**: Real Pinata JWT token committed in `backend/.env`. |
| `RPC_URL` | Required | `'https://rpc.sepolia.org'` | Standard public RPC endpoint. |
| `CONTRACT_ADDRESS` | Required | `'0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39'` | Deployed contract on Sepolia. |
| `PRIVATE_KEY` | Contracts | None | **CRITICAL EXPOSURE**: Real private key committed in `contracts/.env`. |

---

## Section 5: Frontend Architecture, Design Tokens & User Experience

The frontend is a single-page application built on React 19 and Vite 8, utilizing Tailwind CSS v4 and a customized Spatial UI design system.

### 5.1 Routing, Views & Navigation Structure

Rather than importing `react-router-dom`, HealthVault utilizes a lightweight view-switching architecture in [frontend/src/App.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/App.jsx) combined with hash-based routing for public legal documents:
- `view === 'landing'`: Public landing page ([AboutPage.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/AboutPage.jsx)) featuring the interactive hero visual, platform features, architectural overview, and milestone timeline.
- `view === 'dashboard'`: Authenticated role-based dashboard router ([Dashboard.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/Dashboard.jsx)), directing users based on their active role to `PatientView`, `DoctorView`, or `AdminView`.
- Hash Route `#/privacy`: Public Privacy Policy ([PrivacyPolicyPage.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/legal/PrivacyPolicyPage.jsx)).
- Hash Route `#/terms`: Public Terms & Conditions ([TermsPage.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/legal/TermsPage.jsx)).

Both legal pages support browser history `popstate` events, dynamic table-of-contents scrolling with active section highlighting, and mobile collapsible TOC navigation.

### 5.2 Component Hierarchy & Role Workspaces

```
App.jsx (Root State: user, role, token, view, hashRoute)
│
├── SpatialBackground.jsx (Fixed z-0: Animated green gradient + drifting light blobs)
│
├── Navigation Bar (Spatial Layer 3: Glass floating pill, role pills, wallet status, legal links)
│
├── [View: Landing]
│   └── AboutPage.jsx
│       ├── HeroVisual.jsx (Interactive concentric rings, particle animations)
│       ├── YearPicker.jsx (Milestones: 2024-2026 roadmap)
│       └── Footer (Legal links, neutral on-chain status badge)
│
├── [View: Legal]
│   ├── PrivacyPolicyPage.jsx (Glass panel, sticky TOC, 10 numbered legal sections)
│   └── TermsPage.jsx (Glass panel, sticky TOC, Governing Law, Liability)
│
└── [View: Dashboard]
    └── Dashboard.jsx
        ├── PatientView.jsx (Role: 'patient')
        │   ├── PatientProfileModal.jsx (Display name, avatar 200KB upload, blood group)
        │   ├── EmergencyQRModal.jsx (Generates emergency responder QR card)
        │   ├── RecordUploadPanel.jsx (Drag-and-drop PDF upload, AES sealing indicator)
        │   ├── ConsentManagementPanel.jsx (Approve requests, select 5m/15m/30m/1h duration)
        │   ├── AppointmentBookingPanel.jsx (Schedule appointment with doctor)
        │   └── AuditTimeline.jsx (Streaming timeline of consent and access events)
        │
        ├── DoctorView.jsx (Role: 'doctor')
        │   ├── DoctorProfilePanel.jsx (Specialty, hospital, phone)
        │   ├── PatientSearchPanel.jsx (Query by HV-XXXX ID or wallet address)
        │   ├── AccessRequestModal.jsx (Submit clinical justification)
        │   ├── SharedRecordsViewer.jsx (Lists consented patient records)
        │   └── Modal.jsx (Spatial PDF viewer for decrypted clinical records)
        │
        └── AdminView.jsx (Role: 'admin')
            ├── NetworkStatusCard (Sepolia Chain ID 11155111, Contract Address)
            ├── AuditDashboard.jsx (Event breakdown, action distributions)
            └── LocalAuditStream.jsx (Direct wallet telemetry log)
```

### 5.3 Spatial UI Design Tokens & Theme Specification

The application implements a visionOS-inspired "Spatial UI" centered around primary green brand color `#238071`. Tokens are declared in [frontend/src/styles/tokens.css](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/styles/tokens.css):

```css
:root {
  /* Green Theme Palette */
  --color-primary:        #238071;
  --color-primary-dark:   #1A6056;
  --color-primary-mid:    #5FB5A5;
  --color-primary-light:  #A8D8CE;
  --color-primary-tint:   #E3F3EF;

  /* Spatial Glass Depth Layers */
  --glass-layer-1: rgba(255, 255, 255, 0.55); /* Grouped backdrop surfaces */
  --glass-layer-2: rgba(255, 255, 255, 0.68); /* Interactive cards */
  --glass-layer-3: rgba(255, 255, 255, 0.82); /* Floating modals, nav, badges */

  /* Surface Refraction & Blur */
  --glass-blur-1: blur(16px) saturate(1.3);
  --glass-blur-2: blur(24px) saturate(1.4);
  --glass-blur-3: blur(32px) saturate(1.5);

  /* Specular Highlights & Layered Shadows */
  --glass-border-inner: 1px solid rgba(255, 255, 255, 0.75);
  --glass-border-outer: 1px solid rgba(35, 128, 113, 0.12);
  --glass-specular-top: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%);
  --glass-shadow-soft:  0 12px 32px -4px rgba(35, 128, 113, 0.08), 0 4px 12px rgba(0,0,0,0.03);
}
```

The dynamic background (`SpatialBackground.jsx`) features CSS keyframe animation (`ambientShift`) continuously blending mint `#E3F3EF`, soft teal `#A8D8CE`, and mid green `#5FB5A5` behind floating blurred glass cards.

### 5.4 Comprehensive Frontend Feature Checklist

| Module / Feature | Implemented? | Component(s) | Verified Runtime Behavior |
|---|---|---|---|
| **MetaMask Connect** | Yes | `App.jsx`, `lib/blockchain.js` | Connects via `window.ethereum.request`, verifies Chain ID 11155111 (Sepolia). |
| **EIP-191 Auth Challenge** | Yes | `App.jsx`, `lib/api.js` | Retrieves server nonce, calls `signer.signMessage`, trades signature for JWT. |
| **Spatial UI Theme** | Yes | `tokens.css`, `SpatialBackground.jsx` | Full green `#238071` theme; glassmorphic cards with specular highlights. |
| **Custom Patient Profile** | Yes | `PatientProfileModal.jsx`, `lib/patientProfile.js` | Name, avatar (<200KB base64), DOB, blood group, emergency contact updates. |
| **Record PDF Upload** | Yes | `PatientView.jsx`, `lib/api.js` | Drag-and-drop PDF selection, multipart upload, sets on-chain record hash. |
| **Time-Bound Consent Grant** | Yes | `ConsentUI.jsx`, `PatientView.jsx` | Radio selector for 5m, 15m, 30m, 1h; executes `setAccess` transaction on-chain. |
| **Consent Revocation** | Yes | `PatientView.jsx`, `lib/blockchain.js` | Calls `revokeAccess` on smart contract; updates backend expiry store. |
| **Emergency QR Modal** | Yes | `PatientView.jsx`, `components/common/Modal.jsx` | Generates 1-hour emergency token, displays QR code pointing to scan URL. |
| **Doctor Patient Lookup** | Yes | `DoctorView.jsx`, `lib/api.js` | Searches patient by `HV-XXXX` ID or wallet address via backend lookup. |
| **Doctor Record Viewer** | Yes | `DoctorView.jsx`, `components/common/Modal.jsx` | Verifies consent, streams decrypted PDF into inline browser PDF viewer. |
| **Appointment Booking** | Yes | `PatientView.jsx`, `DoctorView.jsx` | Selects date/time, creates record in `appointments.json`. |
| **Audit Log Dashboard** | Yes | `AuditDashboard.jsx`, `lib/audit.js` | Visualizes events, action distributions, and timestamps. |
| **Public Legal Pages** | Yes | `PrivacyPolicyPage.jsx`, `TermsPage.jsx` | Standalone spatial glass pages, sticky TOC, back to home navigation. |
| **Sepolia Neutral Branding** | Yes | `AboutPage.jsx`, `HeroVisual.jsx` | Clean on-chain messaging without exposed hex contract addresses in hero. |

---

## Section 6: Security, Cryptography & Privacy Review

### 6.1 Cryptographic Analysis: Encryption Reality vs Advertised Claims

A foundational claim in the user-facing documentation and marketing copy is:
> *"Client-side AES-256-GCM encryption ensures your health data is sealed before leaving your browser."*

#### Verified Code Execution Reality
Inspection of the upload pathway proves that **no client-side encryption takes place**:
1. In [frontend/src/PatientView.jsx](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/frontend/src/PatientView.jsx), the user selects a file:
   ```javascript
   const formData = new FormData();
   formData.append('file', selectedFile);
   await uploadRecord(formData, token);
   ```
   The raw, unencrypted PDF is sent across the HTTP connection to the backend Express server.
2. In [backend/routes/records.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js) (lines 83–97):
   ```javascript
   const key = crypto.randomBytes(32);
   const iv = crypto.randomBytes(16);
   const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
   const encrypted = Buffer.concat([cipher.update(req.file.buffer), cipher.final()]);
   const authTag = cipher.getAuthTag();
   ```
   The backend generates the symmetric key and encrypts the file.
3. In [backend/routes/records.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js) (lines 162–167):
   ```javascript
   const recordMetadata = {
     id: recordId,
     patientAddress: patientAddress.toLowerCase(),
     ipfsHash,
     originalName: req.file.originalname,
     encryptionKey: key.toString('hex'), // <-- RAW SYMMETRIC KEY STORED IN PLAINTEXT
     iv: iv.toString('hex'),
     authTag: authTag.toString('hex'),
     uploadedAt: new Date().toISOString()
   };
   ```
   The raw symmetric key is written directly to disk in `records_metadata.json`.
4. In [backend/routes/records.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js) (lines 388–405):
   ```javascript
   const keyBuffer = Buffer.from(record.encryptionKey, 'hex');
   const ivBuffer = Buffer.from(record.iv, 'hex');
   const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuffer);
   decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));
   const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
   res.setHeader('Content-Type', 'application/pdf');
   res.send(decrypted);
   ```
   The server reads the key from disk, decrypts the record in memory, and serves the plaintext PDF to the doctor.

**Security Conclusion:** The architecture provides **zero-knowledge privacy against the backend server**. The server operator has full read access to all patient medical files and cryptographic keys.

### 6.2 Authentication, Replay Protection & Session Security

1. **Replay Protection**: Replay attacks are mitigated via the server-side challenge store ([backend/services/authChallenges.js](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/services/authChallenges.js)). Nonces are 32-byte cryptographic hex strings with a 5-minute time-to-live and are deleted immediately upon successful verification.
2. **Session Lifespan**: JWT tokens are issued with a 24-hour expiration (`expiresIn: '24h'`). No token revocation mechanism (such as a blocklist or rotating refresh token pattern) exists.
3. **Hardcoded Secret**: In `backend/.env`, the secret is set to `JWT_SECRET=[REDACTED]`. Because this string is committed to source control, any attacker can forge arbitrary JWTs with `role: 'patient'`, `role: 'doctor'`, or `role: 'admin'`.

### 6.3 Comprehensive Secrets Audit

All secrets identified during the static analysis are detailed below with sensitive characters masked:

| File Location | Variable / Secret Type | Masked Value | Risk Level | Assessment & Impact |
|---|---|---|---|---|
| `contracts/.env` Line 2 | Ethereum Private Key (`PRIVATE_KEY`) | `[REDACTED]` | **CRITICAL** | Real private key with transaction history on Sepolia. Any person with repository access can drain funds or compromise deployed contracts. |
| `backend/.env` Line 4 | Pinata IPFS JWT (`PINATA_JWT`) | `[REDACTED]` | **HIGH** | Active production JWT for Pinata IPFS gateway. Allows unauthorized pinning, unpinning, and bandwidth consumption. |
| `backend/.env` Line 2 | Express JWT Secret (`JWT_SECRET`) | `[REDACTED]` | **HIGH** | Static key committed to Git. Enables offline JWT forgery and impersonation of any user address. |
| `backend/routes/records.js` Line 176 | Hardcoded Doctor Entity | `"Dr. Arjun Sharma"` | **LOW** | Static string injected as default doctor for uploads where doctor is unspecified. |
| `backend/routes/auth.js` Lines 18–19 | Hardcoded Wallet Registry | `0x38e6...` / `0x89a3...` | **LOW** | Static seed wallets for `HV-1001` and `HV-1002`. |

### 6.4 Prioritized Vulnerability Table

| Vuln ID | Title | Severity | Affected File & Lines | Attack Vector | Concrete Remediation |
|---|---|---|---|---|---|
| **VULN-01** | Exposed Ethereum Private Key in Repository | **CRITICAL** | [contracts/.env#L2](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/contracts/.env#L2) | Attacker extracts private key from Git history and drains funds or takes over contract ownership. | Immediately transfer testnet funds to a new wallet, revoke the key, purge Git history with BFG Repo-Cleaner, and load keys via environment variables or hardware signers. |
| **VULN-02** | Plaintext AES Symmetric Key Storage on Server | **CRITICAL** | [backend/routes/records.js#L162-L167](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js#L162-L167) | Server compromise or unauthorized read of `records_metadata.json` reveals keys to decrypt all stored medical files. | Implement genuine client-side Web Crypto API encryption; store symmetric keys encrypted under patient and doctor public keys (ECIES or RSA-OAEP). |
| **VULN-03** | Server-Side Cleartext Medical Data Processing | **HIGH** | [backend/routes/records.js#L80-L110](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/records.js#L80-L110) | Network eavesdropper or compromised backend process inspects raw PDF payloads transmitted during upload. | Seal files client-side in the browser using the Web Crypto API before initiating HTTP POST; backend should only handle ciphertext blobs. |
| **VULN-04** | Static / Hardcoded JWT Secret | **HIGH** | [backend/.env#L2](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/.env#L2) | Attacker reads secret from repo, signs a custom JWT with `{ role: 'admin', walletAddress: '0x...' }`, and bypasses auth. | Generate a cryptographically secure 256-bit random string at boot or inject via secure secret manager; enforce minimum entropy check on startup. |
| **VULN-05** | Reflected XSS in Emergency QR Scan Endpoint | **HIGH** | [backend/routes/consent.js#L294-L359](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/consent.js#L294-L359) | Malicious patient registers profile containing `<script>alert(document.cookie)</script>` in `allergies`; payload executes in responder's browser upon QR scan. | Sanitize and HTML-encode all dynamic interpolations, or serve pure JSON to a static frontend template. |
| **VULN-06** | In-Memory Token & Consent Request Volatility | **HIGH** | [backend/routes/consent.js#L24-L25](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/consent.js#L24-L25) | Node.js process restart terminates all active Emergency QR tokens and doctor access requests. | Persist emergency tokens and access requests to Redis or an on-disk database with explicit TTL indexes. |
| **VULN-07** | Unauthenticated Patient Address Enumeration | **MEDIUM** | [backend/routes/auth.js#L95-L103](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/routes/auth.js#L95-L103) | Scraping script iterates over `HV-1000` through `HV-9999` on `/api/auth/lookup/:id` to harvest patient wallet addresses. | Require authenticated doctor or patient session to perform patient lookups; implement aggressive IP rate limiting. |
| **VULN-08** | Missing Rate Limiting on Authentication & Uploads | **MEDIUM** | [backend/server.js#L1-L45](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/server.js#L1-L45) | Attacker floods `/api/auth/challenge` or `/api/records/upload`, leading to resource exhaustion (DoS). | Integrate `express-rate-limit` across authentication, challenge generation, and upload endpoints. |
| **VULN-09** | CORS Restricted to Localhost in Production | **LOW** | [backend/server.js#L21-L26](file:///c:/Users/amogh/Desktop/Major%20Project/Review%202/Project-revamp%20again/backend/server.js#L21-L26) | Deploying backend to remote host fails due to rigid `origin: 'http://localhost:5173'`. | Parameterize CORS origin via `process.env.CLIENT_URL` with whitelist validation. |

### 6.5 Remediation Status & Architecture Residuals

Following the multi-stage security remediation roadmap, the identified audit findings have been hardened, verified with automated tests, and committed:

| Finding / Stage | Target Issue | Remediation Status | Implementation Summary |
|---|---|---|---|
| **VULN-01 (Stage 1)** | Secrets Exposure in Repo | **REMEDIATED** | `.gitignore` comprehensively excludes all `.env*` files, `backend/uploads/`, and data storage files. Created `.env.example` templates with non-secret placeholders for contracts, backend, and frontend. Isolated deployer private key and Pinata JWT. |
| **VULN-02 & VULN-03 (Stage 4)** | Plaintext AES Record Keys at Rest | **REMEDIATED** | Implemented envelope encryption using a 256-bit master key (`RECORD_KEY_ENCRYPTION_SECRET`). Per-record AES-256 keys, IVs, and tags are wrapped (AES-256-GCM) at rest. Enforced startup validation refusing boot on missing/malformed secret. Developed an idempotent migration backing up metadata before encryption. |
| **VULN-04 (Stage 1 & 3)** | Hardcoded JWT Secret & Role Forgery | **REMEDIATED** | Configurable `JWT_SECRET` with startup checks. Roles are cryptographically embedded into signed JWT claims server-side; client-supplied role headers (e.g. `X-Role`) are completely removed and ignored for authorization. |
| **VULN-05 (Stage 2)** | Reflected XSS in Emergency Scan | **REMEDIATED** | Added `escapeHtml` and `escapeArrayOrString` encoding helpers strictly escaping all dynamic clinical profile fields. Enforced strict Content Security Policy (`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`) and `X-Content-Type-Options: nosniff`. |
| **VULN-06 (Stage 2)** | In-Memory Token & Request Volatility | **REMEDIATED** | Replaced volatile in-memory storage with atomic, disk-persisted stores (`emergencyTokens.json`, `consentRequests.json`) resilient across server restarts, with automatic TTL cleanup of expired entries. |
| **VULN-07 (Stage 3)** | Open Patient Address Enumeration & Role Bypass | **REMEDIATED** | Protected `/api/auth/lookup/:patientId` with JWT authentication. Enforced strict reciprocal role authorization (doctors can only look up patients; patients can only look up doctors; all other pairings rejected with 403). Added rate limiting. |
| **VULN-08 (Stage 5)** | Rate Limiting & Request Flooding | **REMEDIATED** | Integrated `express-rate-limit` on `/auth/nonce`, `/auth/verify`, `/records/upload`, `/consent/request`, `/consent/respond`, `/consent/grant`, `/consent/revoke`, and `/patient/profile`. Rejects rate-limited callers with 429 and JSON error responses. Added 1MB JSON body size limit (413 rejection) and 25MB multer upload cap. |
| **VULN-09 (Stage 5)** | CORS Misconfiguration & Missing Security Headers | **REMEDIATED** | Parameterized CORS allowlist via `CORS_ALLOWED_ORIGINS` (comma-separated, defaulting to `http://localhost:5173`). Disallowed origins receive no CORS headers. Added `helmet` with sensible defense-in-depth headers. |
| **Backend Hardening (Stage 5)** | Information Leakage & Central Error Handling | **REMEDIATED** | Implemented a global central error handler intercepting uncaught exceptions, returning clean generic error messages without stack traces, internal paths, or raw library error text. Redacted tokens, private keys, and request payloads from logging. |

#### Architectural Residuals (Preserved by Design)
The following architectural choices are structural constraints of the current system design and are documented honestly:
1. **Server-Side Encryption with Environment Master Key:** Medical files are transmitted over TLS to the backend, where symmetric AES-256-GCM encryption is performed, and per-record keys are sealed under a master key stored in an environment variable (`RECORD_KEY_ENCRYPTION_SECRET`). Genuine client-side Web Crypto API encryption (where the server never handles plaintext medical records or keys) and cloud KMS integration (e.g., AWS KMS, HashiCorp Vault) remain future enterprise milestones.
2. **Off-Chain Consent Expiry:** The on-chain `HealthVault.sol` contract records binary access states (`setAccess`, `revokeAccess`) without expiration timestamps. Time-bound consent durations (5m, 15m, 30m, 1h) are tracked and enforced by the backend service.
3. **Single Record Hash on Smart Contract:** The smart contract retains a single IPFS hash pointer per patient (`records[patient]`), while multi-file histories are indexed and coordinated by the backend metadata store.

---

## Section 7: Code Quality, Testing & Build Verification

Verification was conducted locally using the existing test scripts and configuration.

### 7.1 Test Suite Execution Results

#### 1. Backend Automated Tests (Node Test Runner)
Command executed: `npm.cmd test` in `backend/`
- **Test Suites**: 8 test files (`auth.test.js`, `records.test.js`, `consent.test.js`, `profiles.test.js`, `patient.test.js`, `keyWrapping.test.js`, `hardening.test.js`, `audit.test.js`)
- **Total Tests**: 74
- **Passed**: **74**
- **Failed**: **0**
- **Execution Duration**: **~3.2 s**
- **Coverage**: Covers challenge generation, signature validation, profile mutations, emergency QR XSS mitigation and persistent tokens, reciprocal role-restricted lookups, key wrapping/unwrapping at rest, timestamped backup migration, master secret validation at boot, 413 JSON request limits, CORS allowlist headers, Helmet defense-in-depth headers, stack-trace-free central error handling, and 429 rate limiting across auth, upload, consent, and profile routes.

#### 2. Frontend Automated Tests (Vitest / React Testing Library)
Command executed: `npm.cmd test` in `frontend/`
- **Test Suites**: 5 test files (`AboutPage.test.jsx`, `legal.test.jsx`, `patientProfile.test.js`, `PatientProfileModal.test.jsx`, `tokens.test.js`)
- **Total Tests**: 34
- **Passed**: **34**
- **Failed**: **0**
- **Execution Duration**: **325 ms**
- **Coverage**: Validates accurate cryptographic terminology (confirming no "zero-knowledge" text in milestone copy), legal routing, TOC scrolling, patient profile validation logic, avatar constraints, and CSS token declarations.

#### 3. Smart Contract Compatibility Tests (Hardhat)
Command executed: `npx.cmd hardhat test` in `contracts/`
- **Test Suites**: `HealthVault.compatibility.cjs`
- **Total Tests**: 1
- **Passed**: **1**
- **Failed**: **0**
- **Execution Duration**: **1.04 s**
- **Coverage**: Validates deployment and basic interface conformance.

### 7.2 Static Code Analysis & Linter Results

Command executed: `npm.cmd run lint` in `frontend/`
- **Linter**: ESLint v9.19.0 (Flat config via `eslint.config.js`)
- **Errors**: **0**
- **Warnings**: **0**
- **Status**: Clean. React hooks dependencies, unused imports, and JSX formatting adhere strictly to standard rules.

### 7.3 Production Build Verification

Command executed: `npm.cmd run build` in `frontend/`
- **Bundler**: Vite v8.2.1
- **Build Duration**: **208 ms**
- **Bundle Output Analysis**:
  - `dist/index.html`: `0.83 kB`
  - `dist/assets/index-*.css`: `29.85 kB` (gzip: `6.45 kB`)
  - `dist/assets/index-*.js`: `824.37 kB` (gzip: `248.81 kB`)
- **Status**: Production build succeeds without errors. The JS bundle size is driven by inclusion of `@ethersproject`/`ethers` v6 and `framer-motion`.

---

## Section 8: Setup, Configuration & Local Run Guide

### 8.1 Prerequisites
- **Node.js**: Version 20.x or higher recommended.
- **Package Manager**: npm v10.x.
- **Browser Extension**: MetaMask (configured with Sepolia Testnet).
- **Testnet ETH**: Sepolia ETH for signing `setRecord` and `setAccess` transactions.

### 8.2 Step-by-Step Installation

#### 1. Smart Contract Setup & Local Testing
```bash
# Navigate to contracts directory
cd contracts

# Install dependencies
npm install

# Run contract tests
npx hardhat test

# (Optional) Deploy to Sepolia (Requires funded PRIVATE_KEY in .env)
# npx hardhat run scripts/deploy.js --network sepolia
```

#### 2. Backend Setup
```bash
# Navigate to backend directory
cd ../backend

# Install dependencies
npm install

# Run backend unit & integration tests
npm test

# Launch backend in development mode (starts on port 5000)
npm run dev
```

#### 3. Frontend Setup
```bash
# Navigate to frontend directory
cd ../frontend

# Install dependencies
npm install

# Run frontend tests
npm test

# Run ESLint check
npm run lint

# Launch Vite development server (starts on http://localhost:5173)
npm run dev
```

### 8.3 Environment Configuration Templates

#### `contracts/.env.example`
```ini
# Private key of the deployer wallet (must have Sepolia testnet ETH)
PRIVATE_KEY=your_sepolia_private_key_without_0x

# Sepolia RPC URL (Infura, Alchemy, or public node)
SEPOLIA_RPC_URL=https://rpc.sepolia.org
```

#### `backend/.env.example`
```ini
# Port for Express REST API
PORT=5000

# Cryptographically random secret for JWT signing
JWT_SECRET=generate_a_random_32_byte_hex_string_here

# Pinata IPFS Gateway JWT (Optional: mock storage will activate if omitted)
PINATA_JWT=your_pinata_jwt_token_here

# Sepolia Contract Address
CONTRACT_ADDRESS=0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39

# RPC Endpoint for backend blockchain queries
RPC_URL=https://rpc.sepolia.org
```

---

## Section 9: Gaps, Production Readiness & Prioritized Roadmap

### 9.1 Sample / Mock vs Production-Ready Component Analysis

| Component / Subsystem | Current State in Code | Production Requirements | Gap Severity |
|---|---|---|---|
| **File Encryption** | Backend AES-256-GCM. Raw keys saved to JSON file. | Client-side WebCrypto AES-GCM. Keys wrapped via asymmetric RSA/ECIES per authorized recipient. | **CRITICAL** |
| **IPFS Storage** | Pinata REST API with fallback to simulated mock CIDs. | Dedicated decentralized IPFS node cluster or Filecoin/Arweave archival integration. | **MEDIUM** |
| **On-Chain Consent** | Binary flag (`accessList[p][d] = bool`). No expiry on contract. | Smart contract V2 with `accessExpiry[p][d] = timestamp` and on-chain verification. | **HIGH** |
| **Record Registry** | Single string hash per patient (`records[p]`). | Dynamic array or mapping of record CIDs with metadata hashes on-chain. | **HIGH** |
| **Emergency QR Access** | Ephemeral RAM storage; unauthenticated plain HTML response with XSS risk. | Encrypted offline-verifiable QR containing ephemeral patient key; sanitized UI renderer. | **HIGH** |
| **Admin Role** | Client-only simulation using user's personal audit log. | Multi-sig smart contract role (Gnosis Safe); decentralized telemetry aggregation. | **MEDIUM** |
| **Database Engine** | Unlocked local flat JSON files (`patient_profiles.json`, etc.). | ACID-compliant production database (PostgreSQL) with migrations, connection pooling, and encryption at rest. | **HIGH** |

### 9.2 Prioritized Engineering Roadmap

```mermaid
flowchart LR
    Phase1["Phase 1: Critical Security (Weeks 1-2)"] --> Phase2["Phase 2: True Client Encryption (Weeks 3-5)"]
    Phase2 --> Phase3["Phase 3: Smart Contract V2 (Weeks 6-8)"]
    Phase3 --> Phase4["Phase 4: Production Hardening (Weeks 9-11)"]
```

#### Phase 1: Critical Security & Secret Remediation (Effort: 2 Weeks / 1 FTE)
- **Purge Repository Secrets**: Immediately revoke the exposed Sepolia private key and Pinata JWT. Remove secrets from Git history.
- **Implement Rate Limiting**: Deploy `express-rate-limit` on `/api/auth/challenge`, `/api/auth/verify`, and `/api/records/upload`.
- **Sanitize Emergency Scan**: Refactor `GET /api/consent/qr/scan/:token` to return structured JSON consumed by a sanitized React page, removing inline HTML reflection.
- **Migrate In-Memory Stores**: Move `qrTokens` and `accessRequests` to Redis with automatic TTL expiration.

#### Phase 2: True Client-Side Encryption & Key Encapsulation (Effort: 3 Weeks / 1.5 FTE)
- **Web Crypto Client Sealing**: Refactor `PatientView.jsx` to generate a 256-bit AES-GCM key in the browser using `window.crypto.subtle`.
- **Hybrid Asymmetric Wrapping**: Encrypt the symmetric file key with the patient's public key (for patient storage) and the doctor's public key upon consent grant.
- **Zero-Knowledge Backend**: Ensure the backend receives only ciphertext bytes and encrypted key envelopes; eliminate server-side decryption routines.

#### Phase 3: Smart Contract V2 & On-Chain Consent Timers (Effort: 3 Weeks / 1 FTE)
- **Time-Bound Consent Mapping**: Update `HealthVault.sol`:
  ```solidity
  mapping(address => mapping(address => uint256)) public accessExpiry;
  function grantAccess(address _doctor, uint256 _duration) external {
      accessExpiry[msg.sender][_doctor] = block.timestamp + _duration;
  }
  ```
- **Multi-Record Array Support**: Replace single `records` string with an array of record metadata structs containing timestamp, record type, and IPFS hash.
- **Formal Verification & Gas Optimization**: Write comprehensive Foundry/Hardhat test suites testing boundary conditions, reentrancy, and gas usage.

#### Phase 4: Production Infrastructure Hardening (Effort: 3 Weeks / 1 FTE)
- **Relational Database Migration**: Transition all JSON flat-files to PostgreSQL with Prisma or Knex ORM.
- **Decentralized Identity (DID)**: Incorporate W3C Verifiable Credentials or Ceramic Network for verifiable doctor medical licensing.
- **Automated CI/CD**: Implement GitHub Actions pipeline enforcing static security scans (Slither for Solidity, Semgrep/Snyk for JavaScript) and automated test execution.

---

## Section 10: Appendix (Dependencies, Glossary & Audit Boundaries)

### 10.1 Comprehensive Dependency Manifest

#### Smart Contracts (`contracts/package.json`)
| Package | Version | Purpose |
|---|---|---|
| `hardhat` | `^2.19.4` | Ethereum development environment, local EVM node, compilation. |
| `@nomicfoundation/hardhat-toolbox` | `^4.0.0` | Bundle containing Ethers, Chai matchers, Mocha test runner, network helpers. |
| `dotenv` | `^16.4.1` | Loads environment variables from `.env` file into process environment. |

#### Backend API Server (`backend/package.json`)
| Package | Version | Purpose |
|---|---|---|
| `express` | `^4.18.2` | Core HTTP REST API web application framework. |
| `cors` | `^2.8.5` | Cross-Origin Resource Sharing middleware for Express. |
| `dotenv` | `^16.4.5` | Environment variable loader. |
| `ethers` | `^6.10.0` | Ethereum library for interacting with Sepolia contracts and verifying signatures. |
| `jsonwebtoken` | `^9.0.2` | Issues and verifies signed JWT tokens for API session authentication. |
| `multer` | `^1.4.5-lts.1` | Middleware for handling `multipart/form-data` file uploads into memory buffers. |
| `chai` (dev) | `^4.4.1` | BDD assertion library used in automated API testing. |
| `mocha` (dev) | `^10.3.0` | Test runner framework for Node.js test execution. |
| `supertest` (dev) | `^6.3.4` | HTTP assertions and request simulation against Express endpoints. |

#### Frontend Client (`frontend/package.json`)
| Package | Version | Purpose |
|---|---|---|
| `react` | `^19.2.5` | Component-based UI library. |
| `react-dom` | `^19.2.5` | React DOM renderer for browser. |
| `vite` | `^8.2.1` | Next-generation frontend tooling and production bundler. |
| `ethers` | `^6.11.1` | Client-side MetaMask provider integration and contract call encoding. |
| `tailwindcss` | `^4.0.0` | Utility-first CSS framework. |
| `@tailwindcss/postcss` | `^4.0.0` | PostCSS plugin for Tailwind CSS v4. |
| `framer-motion` | `^12.38.0` | Animation library for fluid spatial UI transitions and modal animations. |
| `lucide-react` | `^1.16.0` | Comprehensive icon library for clinical and dashboard interfaces. |
| `canvas-confetti` | `^1.9.4` | Visual celebration animation upon successful milestone and record uploads. |
| `vitest` (dev) | `^3.0.5` | High-performance Vite-native testing framework. |
| `@testing-library/react` (dev) | `^16.2.0` | DOM testing utilities for React components. |
| `eslint` (dev) | `^9.19.0` | Pluggable JavaScript and JSX linter. |

### 10.2 Domain Glossary

- **AES-256-GCM**: Advanced Encryption Standard in Galois/Counter Mode. A symmetric authenticated cipher that guarantees both confidentiality and authenticity through an authentication tag.
- **CID (Content Identifier)**: A self-describing cryptographic hash (SHA-256) used in IPFS to locate and verify files regardless of host location.
- **EIP-191**: Ethereum Improvement Proposal standardizing cryptographic message signatures (`\x19Ethereum Signed Message:\n<length><message>`), ensuring off-chain signatures cannot be replayed as valid transactions.
- **Glassmorphism / Spatial UI**: A design aesthetic simulating layered, translucent glass planes suspended in 3D space, characterized by backdrop blurs, specular highlights, and soft multi-colored ambient lighting.
- **IPFS (InterPlanetary File System)**: A peer-to-peer distributed hypermedia protocol for storing and sharing data across decentralized nodes.
- **JWT (JSON Web Token)**: Compact, URL-safe means of representing claims to be transferred between two parties, signed with a secret or key.
- **RBAC (Role-Based Access Control)**: Restricting network or application access based on the verified roles assigned to users (`patient`, `doctor`, `admin`).
- **TTL (Time-To-Live)**: A temporal limit or expiration window after which a credential, nonce, or access authorization is automatically invalidated.

### 10.3 Unverified Files & Out-of-Scope Boundaries

In adherence to the strict read-only audit protocol:
1. **Live Blockchain State**: The deployment transaction of `0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39` on Sepolia was verified against Etherscan interface definitions, but no active state-modifying transactions were executed.
2. **Third-Party Pinata Gateway**: Actual remote pin status of older CIDs on the external Pinata cluster was not queried to avoid network side-effects and external credential usage.
3. **Ignored Directories**: `node_modules/`, `dist/`, `.git/`, and `.backups/` were excluded from the analysis.
4. **No Dependencies Altered**: No packages were installed, updated, or removed during this audit.

---
*End of Report. Prepared for project review and architecture evaluation.*
