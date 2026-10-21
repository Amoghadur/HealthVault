import LegalPageLayout from "./LegalPageLayout";
import { LEGAL_CONFIG } from "./legalConfig";

export default function PrivacyPolicy({ onBack, onNavigate }) {
  const sections = [
    {
      id: "about-policy",
      number: 1,
      title: "About This Policy",
      content: (
        <>
          <p>
            This Privacy Policy explains how <strong>{LEGAL_CONFIG.PROJECT_NAME}</strong> handles, encrypts, and processes data across our web application.
          </p>
          <div className="legal-highlight-box">
            <strong>Demonstration Prototype Status:</strong> HealthVault is an educational research and engineering demonstration created to investigate patient-mediated consent and decentralized electronic health record indexing. It is <em>not</em> an accredited commercial healthcare provider, medical device, or certified EHR software system.
          </div>
          <p>
            Our core architectural philosophy is <strong>data minimization and patient-led access control</strong>: you manage access to your records through your Ethereum wallet, files are encrypted with AES-256-GCM before storage, access consent is recorded on the blockchain, and access time limits are enforced by the backend service.
          </p>
        </>
      ),
    },
    {
      id: "information-we-handle",
      number: 2,
      title: "Information We Handle",
      content: (
        <>
          <p>
            HealthVault processes only the specific data points required to demonstrate decentralized access control and secure clinical record management:
          </p>
          <ul>
            <li>
              <strong>Public Wallet Address:</strong> Your Ethereum public address (e.g., <code className="legal-code-pill">0x...</code>) serves as your primary sovereign account identifier. We do not use traditional usernames, passwords, or phone number logins.
            </li>
            <li>
              <strong>User Role Selection:</strong> The workspace mode you choose when connecting: <code className="legal-code-pill">patient</code>, <code className="legal-code-pill">doctor</code>, or <code className="legal-code-pill">admin</code>.
            </li>
            <li>
              <strong>Doctor Profile Details:</strong> When a care provider registers or updates their clinical directory profile: provider name, medical specialty, hospital affiliation, years of clinical experience, and public contact email.
            </li>
            <li>
              <strong>Patient Profile Details:</strong> Profile details stored on the backend when provided by the patient: display name, optional photo, phone number, date of birth, blood group, short bio, emergency contact name and phone. Doctors with an active grant can see only the display name and photo.
            </li>
            <li>
              <strong>Uploaded Clinical Records:</strong> Digital health files (such as blood test reports, prescriptions, or discharge summaries in PDF format). Uploaded files are transmitted to the backend server and encrypted with AES-256-GCM before storage.
            </li>
            <li>
              <strong>Document Metadata:</strong> File name, record category (<code className="legal-code-pill">prescription</code>, <code className="legal-code-pill">report</code>, or <code className="legal-code-pill">unspecified</code>), uploader wallet address, timestamp, and generated cryptographic IPFS content identifier (CID).
            </li>
            <li>
              <strong>Appointment Bookings:</strong> Scheduled consultation requests including patient ID, provider name, doctor wallet, preferred date, time slot, and reason for visit.
            </li>
            <li>
              <strong>Consent & Access Grants:</strong> Authorization records defining doctor wallet, patient wallet, granted access duration, expiration timestamp, and on-chain grant status.
            </li>
            <li>
              <strong>Audit Log Entries:</strong> System events logging timestamp, action type (e.g., <code className="legal-code-pill">RecordStored</code>, <code className="legal-code-pill">AccessRequested</code>, <code className="legal-code-pill">EmergencyCreated</code>), actor wallet address, and outcome.
            </li>
          </ul>
          <p>
            <strong>What We Never Collect:</strong> HealthVault does not collect credit card or payment data, national identification numbers (such as Aadhaar or SSN), biometric identifiers, browser fingerprinting data, or third-party advertising identifiers.
          </p>
        </>
      ),
    },
    {
      id: "how-records-are-protected",
      number: 3,
      title: "How Records Are Protected",
      content: (
        <>
          <p>
            Protecting sensitive medical documents requires defense-in-depth cryptography and deterministic permission enforcement:
          </p>
          <ul>
            <li>
              <strong>Server-Side AES-256-GCM File Encryption:</strong> When a document is uploaded, it is sent to the backend server where it is encrypted using authenticated <strong>AES-256-GCM</strong> (Galois/Counter Mode) before persistent storage. In this demonstration version, the service operator&apos;s server handles the encryption keys and performs file decryption when serving authorized requests.
            </li>
            <li>
              <strong>Blockchain-Recorded Patient Consent:</strong> Access to medical records is controlled by patient consent recorded on the blockchain. A care provider cannot retrieve a record without an active consent grant recorded on-chain by the patient.
            </li>
            <li>
              <strong>Backend-Enforced Access Time Limits:</strong> Doctor access permissions are granted for limited duration windows (5 to 60 minutes). These access time limits are enforced by the backend service, which automatically rejects document retrieval requests once the time window expires.
            </li>
            <li>
              <strong>Granular Patient-Selected Record Sharing (Allow-List):</strong> Access is granted on-chain per doctor, and which records are visible is enforced by the backend allow-list. Patients selectively choose exactly which records to share from their vault when granting access or updating an active grant. A doctor can only access records included on that grant's allow-list (plus records the doctor uploaded themselves). If no records are selected on the allow-list, no patient records are accessible.
            </li>
            <li>
              <strong>Instant On-Chain Revocation:</strong> Patients can revoke doctor access at any time via a blockchain transaction, updating the on-chain consent registry and terminating authorization.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "blockchain-transparency",
      number: 4,
      title: "Blockchain Transparency & Immutability",
      content: (
        <>
          <p>
            HealthVault uses public distributed ledger technology ({LEGAL_CONFIG.NETWORK}) to guarantee that access control is provable and transparent:
          </p>
          <div className="legal-highlight-box">
            <strong>Absolute Rule — No Plain Health Records On-Chain:</strong> We explicitly confirm that <em>no medical record contents, raw clinical text, diagnostic findings, or personal medical files are ever stored on the blockchain</em>.
          </div>
          <p>
            The smart contract deployed at <code className="legal-code-pill">{LEGAL_CONFIG.SMART_CONTRACT}</code> only records:
          </p>
          <ol>
            <li>Boolean consent mappings (<code className="legal-code-pill">hasAccess(patient, doctor)</code>) determining whether access is permitted.</li>
            <li>Public transaction hashes documenting when permissions were granted or revoked.</li>
            <li>Encrypted content pointers (IPFS hashes) which cannot be decrypted without off-chain keys.</li>
          </ol>
          <p>
            Because blockchain transactions are permanent and immutable by design, transaction hashes and wallet interaction timestamps become a permanent part of the public ledger and cannot be altered or erased by any party.
          </p>
        </>
      ),
    },
    {
      id: "who-can-see-data",
      number: 5,
      title: "Who Can See Your Data",
      content: (
        <>
          <p>
            Data visibility is governed strictly by access control policies and authenticated sessions:
          </p>
          <ul>
            <li>
              <strong>The Patient:</strong> Has complete visibility and control over personal vault records, active doctor permissions, appointments, and audit history.
            </li>
            <li>
              <strong>Authorized Doctors:</strong> Access is granted on-chain per doctor, and which records are visible is enforced by the backend allow-list. Medical professionals can view and stream only those specific records the patient chose to share on the grant's allow-list (or records the doctor uploaded themselves) during active access windows enforced by the backend service.
            </li>
            <li>
              <strong>Service Operator & Infrastructure:</strong> In this demonstration prototype, the service operator&apos;s server handles the encryption keys and performs file decryption before streaming records to authorized users. The server infrastructure therefore has technical access to the data pipeline during processing.
            </li>
            <li>
              <strong>Auditors & Observers:</strong> Anyone with a blockchain explorer can verify that an access transaction took place on-chain, but no document content or clinical data is recorded on the public ledger.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "emergency-access",
      number: 6,
      title: "Emergency Access & How It Works",
      content: (
        <>
          <p>
            In acute medical crises, patients may be unconscious or unable to approve a MetaMask transaction. HealthVault provides a voluntary <strong>Emergency QR Protocol</strong>:
          </p>
          <ul>
            <li>
              <strong>Patient-Selected Payload:</strong> The patient explicitly configures essential life-saving data: blood type, known severe allergies, current vital medications, and an emergency contact phone number.
            </li>
            <li>
              <strong>Zero-Password Scan:</strong> First responders or emergency room personnel can scan the temporary QR code directly with any standard smartphone camera to view the life-saving card immediately without logging in or holding a Web3 wallet.
            </li>
            <li>
              <strong>Strict 60-Minute Expiration:</strong> Each emergency QR token is cryptographically random and automatically expires after exactly <strong>one hour</strong> (60 minutes). After expiration, scanning the QR code returns an expired notice and no data is displayed.
            </li>
            <li>
              <strong>Audit Logged:</strong> Every emergency token generation (<code className="legal-code-pill">EmergencyCreated</code>) and responder view (<code className="legal-code-pill">EmergencyServed</code>) is written to the system audit log for patient review.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "wallet-keys-responsibility",
      number: 7,
      title: "Ethereum Wallet Keys and Your Responsibility",
      content: (
        <>
          <p>
            HealthVault uses a <strong>non-custodial authentication architecture</strong>. Understanding your cryptographic responsibility is essential:
          </p>
          <ul>
            <li>
              <strong>We Never See Your Wallet Private Keys:</strong> Your Ethereum wallet private keys, secret recovery seed phrases, and wallet passwords remain exclusively inside your wallet software (such as MetaMask) and are never transmitted to our servers. (File encryption keys for stored documents are handled separately by the demonstration backend service).
            </li>
            <li>
              <strong>Signatures Are Not Transactions:</strong> Signing the login challenge message inside your wallet verifies your identity cryptographically without spending cryptocurrency gas fees.
            </li>
            <li>
              <strong>Account Recovery Limits:</strong> Because there is no centralized password database, if you lose your wallet credentials, seed phrase, or private keys, <em>the project team cannot recover your account or restore access to your records</em>.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "cookies-local-storage",
      number: 8,
      title: "Cookies, Local Storage, and Tracking",
      content: (
        <>
          <p>
            HealthVault adheres to a strict zero-surveillance standard:
          </p>
          <div className="legal-highlight-box">
            <strong>No Tracking & No Ads:</strong> HealthVault does not use advertising cookies, marketing pixels, social media trackers, or third-party behavioral analytics scripts.
          </div>
          <p>
            We use standard browser <strong>Local Storage</strong> (<code className="legal-code-pill">localStorage</code>) strictly for technical session management across page refreshes:
          </p>
          <ul>
            <li><code className="legal-code-pill">healthvault_token</code>: Ephemeral JSON Web Token (JWT) proving authenticated wallet session.</li>
            <li><code className="legal-code-pill">healthvault_address</code>: The connected public Ethereum address.</li>
            <li><code className="legal-code-pill">healthvault_role</code>: The active user role (<code className="legal-code-pill">patient</code>, <code className="legal-code-pill">doctor</code>, <code className="legal-code-pill">admin</code>).</li>
            <li><code className="legal-code-pill">healthvault_patient_id</code>: Demonstration patient identifier.</li>
          </ul>
          <p>
            Clicking &quot;Sign Out&quot; or clearing your browser site data immediately removes these keys from your local device.
          </p>
        </>
      ),
    },
    {
      id: "data-retention-deletion",
      number: 9,
      title: "Data Retention & Deletion Limits",
      content: (
        <>
          <p>
            Data retention characteristics differ between off-chain storage and on-chain ledger records:
          </p>
          <ul>
            <li>
              <strong>Demo Server Data Retention:</strong> Patient profile data and uploaded clinical records are stored on the demonstration server and are not erased by blockchain transactions. Patients may delete uploaded records from active indexing in their &quot;My Records&quot; tab, but data on the demonstration server is retained and managed independently of blockchain consensus.
            </li>
            <li>
              <strong>On-Chain Consent Transactions:</strong> In accordance with the immutable nature of public blockchain networks, transactions committed to Ethereum Sepolia (such as smart contract grant and revoke events) remain part of the decentralized ledger history and cannot be deleted or rewritten.
            </li>
            <li>
              <strong>Temporary Emergency Tokens:</strong> Emergency QR tokens are stored in volatile server memory and become completely inaccessible once their 60-minute lifetime expires.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "your-rights-dpdp",
      number: 10,
      title: "Your Rights (DPDP Act, 2023 Principles)",
      content: (
        <>
          <p>
            In alignment with plain-language principles of privacy and India’s <em>Digital Personal Data Protection Act, 2023 (DPDP Act)</em>—described here transparently without claiming formal enterprise certification:
          </p>
          <ul>
            <li>
              <strong>Right to Access:</strong> You have the right to view all personal health files, doctor grants, appointment logs, and audit trails stored in your vault.
            </li>
            <li>
              <strong>Right to Correction:</strong> You can edit emergency clinical payload fields (blood type, allergies, medications, contacts) and doctor profile data at any time.
            </li>
            <li>
              <strong>Right to Withdraw Consent / Revoke Access:</strong> You can revoke doctor viewing permissions at any moment via an instant on-chain transaction.
            </li>
            <li>
              <strong>Right to Erasure:</strong> You can delete your uploaded medical files from off-chain storage.
            </li>
            <li>
              <strong>Right of Grievance Redressal:</strong> You can contact the project team at{" "}
              {LEGAL_CONFIG.CONTACT_EMAILS.map((email, idx) => (
                <span key={email}>
                  {idx > 0 && " or "}
                  <a href={`mailto:${email}`} style={{ color: "var(--primary-dark)", fontWeight: 600 }}>
                    {email}
                  </a>
                </span>
              ))}{" "}
              with any privacy inquiries.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "childrens-data",
      number: 11,
      title: "Children’s Data",
      content: (
        <>
          <p>
            HealthVault is an experimental demonstration platform and is not designed for direct, unattended use by minors under the age of 18.
          </p>
          <p>
            Any pediatric clinical records uploaded for demonstration or family care scenarios must be managed solely under the direct custody and supervision of a parent or legal guardian holding full control of the associated Ethereum wallet.
          </p>
        </>
      ),
    },
    {
      id: "policy-changes",
      number: 12,
      title: "Changes to This Policy",
      content: (
        <>
          <p>
            As an evolving academic research and capstone project, this Privacy Policy may be updated to reflect new smart contract features, encryption refinements, or interface enhancements.
          </p>
          <p>
            Any modifications will be posted directly to this public URL (<code className="legal-code-pill">/privacy</code>) with a revised &quot;Last updated&quot; date at the top of the document.
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
            If you have questions, feedback, or security observations concerning this demonstration Privacy Policy, please contact the project team:
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
      title="Privacy Policy"
      subtitle="How HealthVault protects clinical records, records patient consent on-chain, and enforces time-limited access."
      sections={sections}
      onBack={onBack}
      onNavigate={onNavigate}
    />
  );
}
