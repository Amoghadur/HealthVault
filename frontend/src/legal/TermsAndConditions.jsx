import LegalPageLayout from "./LegalPageLayout";
import { LEGAL_CONFIG } from "./legalConfig";

export default function TermsAndConditions({ onBack, onNavigate }) {
  const sections = [
    {
      id: "acceptance-of-terms",
      number: 1,
      title: "Acceptance of Terms",
      content: (
        <>
          <p>
            Welcome to <strong>{LEGAL_CONFIG.PROJECT_NAME}</strong>. By accessing this website, connecting an Ethereum wallet, or using any feature of our platform, you acknowledge that you have read, understood, and agreed to be bound by these Terms & Conditions.
          </p>
          <p>
            If you do not agree with any part of these terms, please do not connect your wallet or interact with the platform.
          </p>
        </>
      ),
    },
    {
      id: "nature-of-service",
      number: 2,
      title: "Nature of the Service (Academic Demonstration)",
      content: (
        <>
          <p>
            HealthVault is an engineering capstone major project and research prototype developed to investigate blockchain-based electronic health record consent, AES-256-GCM encrypted storage, and auditability.
          </p>
          <div className="legal-highlight-box">
            <p style={{ margin: "0 0 10px 0" }}>
              <strong>Not Medical Advice:</strong> The HealthVault software, demonstration records, and related materials are for informational and technical demonstration purposes only. Nothing on this website constitutes professional medical advice, clinical diagnosis, or a medical recommendation.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Not for Acute Emergencies:</strong> The Emergency QR feature is a cryptographic demonstration. In any genuine medical emergency, you must immediately contact local emergency services (such as 112 in India) or proceed to the nearest accredited emergency hospital.
            </p>
          </div>
          <p>
            Using this platform does not create a doctor-patient, fiduciary, or hospital-patient relationship between you and the project team or participating users.
          </p>
        </>
      ),
    },
    {
      id: "eligibility-and-accounts",
      number: 3,
      title: "Eligibility and Accounts",
      content: (
        <>
          <p>
            To use HealthVault, you must be at least 18 years of age or possess authorized parental or legal guardian consent.
          </p>
          <p>
            Authentication is non-custodial and operates via Ethereum cryptographic signatures. HealthVault supports three user roles:
          </p>
          <ul>
            <li><strong>Patient:</strong> Manages their personal vault, uploads clinical records, and issues temporary access grants.</li>
            <li><strong>Doctor (Care Provider):</strong> Reviews patient records during active consent windows, maintains their provider profile, and uploads prescriptions.</li>
            <li><strong>Admin:</strong> Observes blockchain network verification and smart contract health.</li>
          </ul>
          <p>
            Users choosing the Doctor role agree to provide truthful and accurate professional information (such as their clinical specialty and hospital or clinic affiliation).
          </p>
        </>
      ),
    },
    {
      id: "wallet-and-network-use",
      number: 4,
      title: "Wallet and Network Use",
      content: (
        <>
          <p>
            When interacting with HealthVault, you interact directly with the public Ethereum network ({LEGAL_CONFIG.NETWORK}):
          </p>
          <ul>
            <li>
              <strong>Wallet Responsibility:</strong> You are solely responsible for the security of your Web3 wallet (e.g., MetaMask), your Ethereum private keys, and your seed phrase. HealthVault never handles your wallet private keys.
            </li>
            <li>
              <strong>Network Gas Fees:</strong> Executing smart contract transactions (such as <code className="legal-code-pill">grantAccess</code> or <code className="legal-code-pill">revokeAccess</code>) requires network gas fees. You are responsible for providing appropriate testnet Sepolia ETH to broadcast transactions.
            </li>
            <li>
              <strong>Irreversibility of Blockchain Transactions:</strong> Transactions broadcast to a blockchain network are autonomous, irreversible, and immutable once confirmed by network consensus.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "patient-consent-doctor-obligations",
      number: 5,
      title: "Patient Consent & Doctor Obligations",
      content: (
        <>
          <p>
            HealthVault enforces a strict <strong>consent-first clinical protocol</strong>:
          </p>
          <ul>
            <li>
              <strong>Doctor Viewing Authorization:</strong> Care providers may only view and stream patient clinical files if the patient has granted consent recorded on the blockchain, and only within the active duration window enforced by the backend service.
            </li>
            <li>
              <strong>Confidentiality:</strong> Doctors agree to maintain the strictest confidentiality regarding any patient medical data viewed during an active consent session and must not disclose, export, or misuse such information.
            </li>
            <li>
              <strong>No Access Circumvention:</strong> Doctors must never attempt to bypass pre-flight verification checks, inspect unauthorized memory, or retain unencrypted cached documents after a patient’s consent grant has expired or been revoked.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "acceptable-use",
      number: 6,
      title: "Acceptable Use Policy",
      content: (
        <>
          <p>
            By using HealthVault, you agree that you will not:
          </p>
          <ul>
            <li>Upload malicious files, viruses, corrupted PDF payloads, or illicit content.</li>
            <li>Upload medical records belonging to third parties without their documented consent or legal guardianship authority.</li>
            <li>Attempt to probe, vulnerability-scan, penetrate, reverse-engineer, or denial-of-service the backend server or smart contracts.</li>
            <li>Misrepresent your identity, impersonate certified medical practitioners, or submit false clinical credentials.</li>
            <li>Use automated scrapers, bots, or extraction scripts against the application or IPFS gateways.</li>
          </ul>
        </>
      ),
    },
    {
      id: "uploaded-content-ownership",
      number: 7,
      title: "Uploaded Content and Ownership",
      content: (
        <>
          <p>
            <strong>You Retain Ownership:</strong> Patients retain full intellectual property, privacy, and personal rights in all clinical documents, images, and medical history uploaded to HealthVault.
          </p>
          <p>
            <strong>Limited Operational License:</strong> By uploading a record, you grant HealthVault a limited, revocable, non-exclusive license solely to encrypt, store, index, and transmit the files as necessary to operate the access control workflow you initiate.
          </p>
          <p>
            You may delete your uploaded files from off-chain storage at any time through the dashboard interface.
          </p>
        </>
      ),
    },
    {
      id: "security-and-availability",
      number: 8,
      title: "Security and Availability",
      content: (
        <>
          <p>
            We implement security practices including server-side AES-256-GCM file encryption, JWT session authentication, blockchain-recorded consent, and backend-enforced access duration windows. In this demonstration prototype, encryption keys are handled by the server.
          </p>
          <p>
            However, because HealthVault is an academic prototype:
          </p>
          <ul>
            <li>The service is provided on an <strong>&quot;AS IS&quot;</strong> and <strong>&quot;AS AVAILABLE&quot;</strong> basis without warranties of uninterrupted uptime or error-free operation.</li>
            <li>The service may be temporarily unavailable due to network maintenance, blockchain testnet forks, RPC latency, or server restarts.</li>
            <li>You are strongly advised to keep independent primary backups of your essential medical documentation.</li>
          </ul>
        </>
      ),
    },
    {
      id: "disclaimers-and-liability",
      number: 9,
      title: "Disclaimers & Limitation of Liability",
      content: (
        <>
          <div className="legal-highlight-box">
            <p style={{ margin: "0 0 10px 0" }}>
              <strong>DISCLAIMER OF WARRANTIES:</strong> TO THE FULLEST EXTENT PERMITTED BY LAW, THE PROJECT AUTHORS, CONTRIBUTORS, AND ADVISORS DISCLAIM ALL WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR MEDICAL PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p style={{ margin: 0 }}>
              <strong>LIMITATION OF LIABILITY:</strong> UNDER NO CIRCUMSTANCES SHALL THE PROJECT TEAM BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING FROM: (A) LOST RECORDS OR CORRUPTED FILES; (B) INABILITY TO ACCESS WALLETS OR PRIVATE KEYS; (C) SMART CONTRACT RPC DELAYS; (D) RELIANCE ON EMERGENCY QR DATA IN ACUTE CRISES; OR (E) UNAUTHORIZED THIRD-PARTY ACCESS.
            </p>
          </div>
        </>
      ),
    },
    {
      id: "suspension-or-termination",
      number: 10,
      title: "Suspension or Termination",
      content: (
        <>
          <p>
            The project team reserves the right to suspend or discontinue the HealthVault academic prototype, reset demonstration databases, or revoke API access for any user violating these terms at any time, with or without prior notice.
          </p>
          <p>
            Upon termination, your right to use the platform ceases immediately, though on-chain ledger records previously broadcast remain part of the public Ethereum history.
          </p>
        </>
      ),
    },
    {
      id: "governing-law",
      number: 11,
      title: "Governing Law",
      content: (
        <>
          <p>
            These Terms & Conditions are governed by and construed in accordance with the laws of <strong>India</strong>, without regard to conflict of law principles.
          </p>
        </>
      ),
    },
    {
      id: "changes-to-terms",
      number: 12,
      title: "Changes to the Terms",
      content: (
        <>
          <p>
            We may revise these Terms & Conditions from time to time to accommodate project evolution and technical updates.
          </p>
          <p>
            The current version will always be available at this public URL (<code className="legal-code-pill">/terms</code>) with the updated date clearly indicated. Continued interaction with the platform constitutes acceptance of the revised terms.
          </p>
        </>
      ),
    },
    {
      id: "contact-information",
      number: 13,
      title: "Contact Information",
      content: (
        <>
          <p>
            For questions, legal inquiries, or correspondence regarding these Terms & Conditions, please contact:
          </p>
          <div className="legal-highlight-box">
            <div><strong>Project:</strong> {LEGAL_CONFIG.PROJECT_NAME}</div>
            <div style={{ marginTop: "4px" }}>
              <strong>Contact Email:</strong>{" "}
              {LEGAL_CONFIG.CONTACT_EMAILS.map((email, idx) => (
                <span key={email}>
                  {idx > 0 && ", "}
                  <a href={`mailto:${email}`} style={{ color: "var(--primary-dark)", fontWeight: 600 }}>
                    {email}
                  </a>
                </span>
              ))}
            </div>
            <div style={{ marginTop: "4px" }}><strong>Location:</strong> {LEGAL_CONFIG.LOCATION}</div>
          </div>
        </>
      ),
    },
  ];

  return (
    <LegalPageLayout
      title="Terms & Conditions"
      subtitle="The academic and cryptographic terms governing use of the HealthVault demonstration system."
      sections={sections}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
}
