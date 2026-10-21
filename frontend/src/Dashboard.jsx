import { useState, useEffect } from "react";
import PatientView from "./PatientView";
import DoctorView from "./DoctorView";
import AdminView from "./AdminView";
import AuditDashboard from "./components/AuditDashboard";
import PillButton from "./components/common/PillButton";
import SpatialBackground from "./components/common/SpatialBackground";
import PatientProfileModal from "./components/patient/PatientProfileModal";
import { apiRequest } from "./lib/api";
import { formatShortAddress } from "./lib/patientProfile";

function PrivacyPanel({ onNavigate }) {
  return (
    <div className="panel spatial-panel">
      <span className="section-label" style={{ marginBottom: "12px" }}>
        PRIVACY CENTRE
      </span>
      <h2 className="two-tone-heading" style={{ fontSize: "28px", marginTop: "4px" }}>
        You are always <span className="highlight-primary">in sovereign control.</span>
      </h2>

      <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "14px", maxWidth: "680px" }}>
        HealthVault enforces patient-led access control. Approved care providers can only inspect records
        for which you have granted consent recorded on-chain, within time limits enforced by the backend service.
        The audit dashboard distinguishes smart contract consensus events from recorded server storage operations.
      </p>

      <div style={{ marginTop: "14px", display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "13px" }}>
        <a
          href="/privacy"
          onClick={(e) => {
            e.preventDefault();
            onNavigate && onNavigate("privacy");
          }}
          style={{ color: "var(--primary-dark)", fontWeight: 600, textDecoration: "underline" }}
        >
          View Full Privacy Policy →
        </a>
        <a
          href="/terms"
          onClick={(e) => {
            e.preventDefault();
            onNavigate && onNavigate("terms");
          }}
          style={{ color: "var(--primary-dark)", fontWeight: 600, textDecoration: "underline" }}
        >
          View Terms & Conditions →
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: "16px",
          marginTop: "28px",
        }}
      >
        {[
          ["Active permissions", "Manage access durations (5 to 60 min) enforced by the backend."],
          ["Emergency access", "One-hour auto-expiring emergency QR with zero login."],
          ["Audit trail", "Activity log of data access and on-chain consent events."],
        ].map(([title, text]) => (
          <div
            key={title}
            style={{
              padding: "20px",
              border: "1px solid var(--glass-l1-border)",
              borderRadius: "var(--radius-spatial-md)",
              background: "var(--glass-l1-bg)",
              backdropFilter: "var(--glass-l1-blur)",
              WebkitBackdropFilter: "var(--glass-l1-blur)",
              boxShadow: "var(--glass-l1-shadow)",
            }}
          >
            <strong style={{ display: "block", fontSize: "14px", color: "var(--text-primary)", marginBottom: "6px" }}>
              {title}
            </strong>
            <span style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: 1.5 }}>
              {text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getActivePageFromHash(role) {
  const hash = (window.location.hash || "").toLowerCase().replace(/^#\/?/, "");
  if (hash === "activity" || hash === "audit") return "activity";
  if (hash === "privacy") return "privacy";
  if (role === "doctor" && hash === "appointments") return "appointments";
  if (role === "doctor" && (hash === "outgoing-requests" || hash === "requests" || hash === "outgoing")) return "outgoing-requests";
  return "overview";
}

export default function Dashboard({ account, role, onDisconnect, onNavigate }) {
  const [activePage, setActivePage] = useState(() => getActivePageFromHash(role));
  const [menuOpen, setMenuOpen] = useState(false);
  const [patientProfile, setPatientProfile] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const navigatePage = (page, hash) => {
    setActivePage(page);
    setMenuOpen(false);
    if (typeof window !== "undefined" && window.location) {
      window.location.hash = hash;
    }
  };

  useEffect(() => {
    const handleHash = () => {
      setActivePage(getActivePageFromHash(role));
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [role]);

  useEffect(() => {
    if (role !== "patient" || !account) return;
    let active = true;
    apiRequest("/api/patient/profile")
      .then((data) => {
        if (active && data?.profile) {
          setPatientProfile(data.profile);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [role, account]);

  const copy = {
    patient: [
      "My Health Space",
      "Your clinical records, doctor access, and emergency profile — in one sovereign place.",
    ],
    doctor: [
      "Clinical Workspace",
      "Inspect patient records strictly upon verified, time-limited cryptographic consent.",
    ],
    admin: [
      "Network Overview",
      "Verifiable audit trail and consensus telemetry across Sepolia blocks.",
    ],
  }[role] || ["HealthVault Workspace", "Decentralized electronic health records."];

  const showOverview = () => {
    if (role === "patient") {
      return (
        <PatientView
          account={account}
          patientProfile={patientProfile}
          setPatientProfile={setPatientProfile}
          openProfileModal={() => setProfileModalOpen(true)}
        />
      );
    }
    if (role === "doctor") {
      return (
        <DoctorView
          account={account}
          activePage={activePage}
          onNavigatePage={(page) => navigatePage(page, page)}
        />
      );
    }
    if (role === "admin") {
      return <AdminView account={account} />;
    }
    return null;
  };

  return (
    <div className="workspace-shell">
      <SpatialBackground />

      {/* Sidebar */}
      <aside className={`sidebar ${menuOpen ? "menu-open" : ""}`}>
        {/* Top-edge specular highlight */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "1px",
            background: "var(--specular-highlight)",
            pointerEvents: "none",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
          }}
        />

        <div className="brand">
          <span>✦</span> HealthVault
        </div>

        <div
          className="profile-chip"
          onClick={() => role === "patient" && setProfileModalOpen(true)}
          style={role === "patient" ? { cursor: "pointer" } : undefined}
          title={role === "patient" ? "Edit patient profile" : undefined}
        >
          <div style={{ overflow: "hidden" }}>
            {role === "patient" && patientProfile?.avatar ? (
              <img
                src={patientProfile.avatar}
                alt=""
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              (role === "patient" && patientProfile?.displayName ? patientProfile.displayName[0] : role[0]).toUpperCase()
            )}
          </div>
          <span>
            <small>Signed in as</small>
            <strong>{role === "patient" && patientProfile?.displayName ? patientProfile.displayName : role}</strong>
          </span>
        </div>

        <button
          className="mobile-menu"
          aria-expanded={menuOpen}
          aria-controls="dashboard-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menu {menuOpen ? "✕" : "☰"}
        </button>

        <nav id="dashboard-nav" aria-label="Dashboard navigation">
          <a
            href="#overview"
            className={activePage === "overview" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              navigatePage("overview", "overview");
            }}
          >
            <span>⌂</span>
            <span>Workspace</span>
          </a>

          <a
            href="#activity"
            className={activePage === "activity" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              navigatePage("activity", "activity");
            }}
          >
            <span>◫</span>
            <span>Audit Dashboard</span>
          </a>

          {role === "doctor" && (
            <>
              <a
                href="#appointments"
                className={activePage === "appointments" ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  navigatePage("appointments", "appointments");
                }}
              >
                <span>📅</span>
                <span>Appointments</span>
              </a>

              <a
                href="#outgoing-requests"
                className={activePage === "outgoing-requests" ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  navigatePage("outgoing-requests", "outgoing-requests");
                }}
              >
                <span>📨</span>
                <span>Outgoing Requests</span>
              </a>
            </>
          )}

          <a
            href="#privacy"
            className={activePage === "privacy" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              navigatePage("privacy", "privacy");
            }}
          >
            <span>◌</span>
            <span>Privacy Centre</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          {role === "patient" && (
            <button
              type="button"
              className="glass-card spatial-layer-2"
              onClick={() => setProfileModalOpen(true)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "var(--radius-spatial-md)",
                cursor: "pointer",
                textAlign: "left",
                marginBottom: "14px",
                border: "1px solid var(--border-soft)",
                background: "var(--glass-l2-bg)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
              title="Click to edit patient profile"
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-mid) 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "14px",
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.7)",
                }}
              >
                {patientProfile?.avatar ? (
                  <img src={patientProfile.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  (patientProfile?.displayName || "P").trim().charAt(0).toUpperCase()
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {patientProfile?.displayName || "Add your name"}
                </div>
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--primary-dark)" }}>
                  {formatShortAddress(account)}
                </div>
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>✎</span>
            </button>
          )}

          <p>CONNECTED WALLET</p>
          <code>
            {formatShortAddress(account)}
          </code>

          <div style={{ marginTop: "12px" }}>
            <PillButton
              size="sm"
              variant="outline"
              onClick={onDisconnect}
              style={{ width: "100%", justifyContent: "center" }}
            >
              Sign out
            </PillButton>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="section-label" style={{ marginBottom: "8px" }}>
              {activePage === "overview"
                ? `${role.toUpperCase()} WORKSPACE`
                : activePage === "outgoing-requests"
                ? "ACCESS DISPATCH"
                : activePage === "appointments"
                ? "CONSULTATION QUEUE"
                : activePage === "activity"
                ? "AUDIT TELEMETRY"
                : "PRIVACY SOVEREIGNTY"}
            </span>

            <h1 className="two-tone-heading">
              {activePage === "overview" ? (
                <>
                  {copy[0].split(" ")[0]}{" "}
                  <span className="highlight-primary">
                    {copy[0].split(" ").slice(1).join(" ")}
                  </span>
                </>
              ) : activePage === "outgoing-requests" ? (
                <>
                  Outgoing <span className="highlight-primary">Requests</span>
                </>
              ) : activePage === "appointments" ? (
                <>
                  Patient <span className="highlight-primary">Appointments</span>
                </>
              ) : activePage === "activity" ? (
                <>
                  Verifiable <span className="highlight-primary">Activity</span>
                </>
              ) : (
                <>
                  Privacy <span className="highlight-primary">Centre</span>
                </>
              )}
            </h1>

            <p>
              {activePage === "overview"
                ? copy[1]
                : activePage === "outgoing-requests"
                ? "Track access requests dispatched to patients across the network."
                : activePage === "appointments"
                ? "Review and manage patient consultation requests and scheduled appointments."
                : activePage === "activity"
                ? "A verifiable ledger of Ethereum Sepolia smart contract events and server records."
                : "Understand and manage cryptographic access to your clinical information."}
            </p>
          </div>

          <div className="secure-badge">
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--primary-dark)",
              }}
            />
            <span>Sepolia Verified</span>
          </div>
        </header>

        {(activePage === "overview" || (role === "doctor" && (activePage === "appointments" || activePage === "outgoing-requests"))) && showOverview()}
        {activePage === "activity" && <AuditDashboard account={account} />}
        {activePage === "privacy" && <PrivacyPanel onNavigate={onNavigate} />}
      </main>

      {role === "patient" && (
        <PatientProfileModal
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          initialProfile={patientProfile}
          onSaveSuccess={(p) => setPatientProfile(p)}
        />
      )}
    </div>
  );
}
