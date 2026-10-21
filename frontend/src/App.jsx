import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import Lenis from "lenis";
import Dashboard from "./Dashboard";
import AboutPage from "./AboutPage";
import PrivacyPolicy from "./legal/PrivacyPolicy";
import TermsAndConditions from "./legal/TermsAndConditions";
import PillButton from "./components/common/PillButton";
import SpatialBackground from "./components/common/SpatialBackground";
import SpatialCard from "./components/common/SpatialCard";

const roles = [
  {
    id: "patient",
    icon: "◉",
    title: "Patient",
    text: "Personal vault, records & emergency access.",
  },
  {
    id: "doctor",
    icon: "✚",
    title: "Care Provider",
    text: "Review clinical records with active consent.",
  },
  {
    id: "admin",
    icon: "◇",
    title: "System Admin",
    text: "Oversee verified Sepolia network events.",
  },
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function getRouteFromLocation() {
  const path = (window.location.pathname || "").toLowerCase();
  const hash = (window.location.hash || "").toLowerCase();
  if (path === "/privacy" || hash === "#/privacy" || hash === "#privacy") return "privacy";
  if (path === "/terms" || hash === "#/terms" || hash === "#terms") return "terms";
  return null;
}

export default function App() {
  const [legalRoute, setLegalRoute] = useState(getRouteFromLocation);
  const [account, setAccount] = useState(() => {
    try {
      const token = localStorage.getItem("healthvault_token");
      const addr = localStorage.getItem("healthvault_address");
      return (token && addr) ? addr : null;
    } catch { return null; }
  });
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem("healthvault_role") || "patient";
    } catch { return "patient"; }
  });
  const [showAbout, setShowAbout] = useState(() => {
    try {
      const token = localStorage.getItem("healthvault_token");
      const addr = localStorage.getItem("healthvault_address");
      return !(token && addr);
    } catch { return true; }
  });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Sync route state with browser back/forward and hash changes
  useEffect(() => {
    const handleLocationChange = () => {
      setLegalRoute(getRouteFromLocation());
    };
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  const navigateTo = useCallback((target, targetRole) => {
    if (target === "privacy") {
      window.history.pushState({}, "", "/privacy");
      setLegalRoute("privacy");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (target === "terms") {
      window.history.pushState({}, "", "/terms");
      setLegalRoute("terms");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (target === "auth") {
      if (targetRole) setRole(targetRole);
      if (window.location.pathname !== "/") {
        window.history.pushState({}, "", "/");
      }
      setLegalRoute(null);
      setShowAbout(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      if (window.location.pathname !== "/") {
        window.history.pushState({}, "", "/");
      }
      setLegalRoute(null);
      setShowAbout(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  // Initialize Lenis smooth scroll
  useEffect(() => {
    let lenis;
    try {
      lenis = new Lenis({
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        autoRaf: true,
      });
    } catch {
      // Graceful fallback if smooth scroll unsupported
    }
    return () => {
      lenis?.destroy?.();
    };
  }, []);

  const disconnect = useCallback((notice = "") => {
    for (const key of ["token", "address", "role", "patient_id"]) {
      localStorage.removeItem(`healthvault_${key}`);
    }
    setAccount(null);
    setStatus(notice);
  }, []);

  useEffect(() => {
    if (!account || !window.ethereum?.on) return;
    const walletChanged = () =>
      disconnect("Your wallet or network changed. Reconnect to continue with the correct account.");
    window.ethereum.on("accountsChanged", walletChanged);
    window.ethereum.on("chainChanged", walletChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", walletChanged);
      window.ethereum.removeListener?.("chainChanged", walletChanged);
    };
  }, [account, disconnect]);

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        setStatus("MetaMask is needed to continue.");
        return;
      }

      setLoading(true);
      setStatus("Opening your wallet…");

      // Step 1 — Get wallet address from MetaMask
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const address = accounts[0];

      // Step 2 — Get nonce from backend
      setStatus("Starting secure sign-in…");
      const nonceResponse = await fetch(
        `${API_URL}/auth/nonce/${encodeURIComponent(address)}`
      );
      const nonceData = await nonceResponse.json();

      if (!nonceResponse.ok || !nonceData.nonce || !nonceData.message) {
        throw new Error(nonceData.error || "Could not start secure sign-in.");
      }

      // Step 3 — Sign message in MetaMask
      setStatus("Please approve the sign-in in MetaMask…");
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(nonceData.message);

      // Step 4 — Send signature to backend for verification
      setStatus("Verifying your identity…");
      const verifyResponse = await fetch(`${API_URL}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature, role }),
      });
      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.token) {
        throw new Error(verifyData.error || "Wallet verification failed.");
      }

      // Step 5 — Save token and go to dashboard
      localStorage.setItem("healthvault_token", verifyData.token);
      localStorage.setItem("healthvault_address", address);
      localStorage.setItem("healthvault_role", role);
      localStorage.setItem("healthvault_patient_id", verifyData.patientId);

      setAccount(verifyData.address || address);
      setStatus("");
    } catch (err) {
      if (err.code === 4001) {
        setStatus("You can connect whenever you're ready.");
      } else {
        setStatus(`Could not connect: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Public Legal Pages
  if (legalRoute === "privacy") {
    return (
      <PrivacyPolicy
        onBack={() => navigateTo("home")}
        onNavigate={navigateTo}
      />
    );
  }

  if (legalRoute === "terms") {
    return (
      <TermsAndConditions
        onBack={() => navigateTo("home")}
        onNavigate={navigateTo}
      />
    );
  }

  // First page: Public Editorial Landing page
  if (showAbout) {
    return (
      <AboutPage
        onBack={() => setShowAbout(false)}
        onOpenAuth={(selectedRole) => {
          if (selectedRole) setRole(selectedRole);
          setShowAbout(false);
        }}
        onNavigate={navigateTo}
      />
    );
  }

  // After wallet connection: Dashboard
  if (account) {
    return (
      <Dashboard
        account={account}
        role={role}
        onDisconnect={() => disconnect()}
        onNavigate={navigateTo}
      />
    );
  }

  // Auth screen: single centred floating glass card over the drifting green backdrop
  return (
    <div className="app-frame-wrapper" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SpatialBackground />

      {/* Floating Pill Top Bar */}
      <header
        className="spatial-layer-3"
        style={{
          width: 'calc(100% - 32px)',
          maxWidth: '1240px',
          margin: '16px auto 0',
          padding: '12px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 'var(--radius-pill)',
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(32px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.5)',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          outline: '1px solid rgba(35, 128, 113, 0.12)',
          boxShadow: '0 12px 36px rgba(14, 14, 16, 0.04), 0 24px 60px rgba(35, 128, 113, 0.12), inset 0 1px 1px #FFFFFF',
          position: 'sticky',
          top: '16px',
          zIndex: 50,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
          }}
          onClick={() => navigateTo('home')}
        >
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '9px',
              background: 'var(--accent-gradient)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 700,
            }}
          >
            ✦
          </div>
          <span
            style={{
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            HealthVault
          </span>
        </div>

        <button
          type="button"
          onClick={() => navigateTo('home')}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          ← Back to Overview
        </button>
      </header>

      {/* Centered Floating Glass Card Container */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px 60px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <SpatialCard
          depth={3}
          maxTilt={5}
          style={{
            maxWidth: '560px',
            width: '100%',
            padding: 'clamp(36px, 5vw, 48px)',
            borderRadius: 'var(--radius-spatial-xl)',
            position: 'relative',
          }}
        >
          <span className="section-label" style={{ marginBottom: '12px' }}>
            STEP 01 — SELECT WORKSPACE
          </span>

          <h2
            className="two-tone-heading"
            style={{
              fontSize: 'clamp(26px, 3.4vw, 34px)',
              margin: '0 0 8px 0',
            }}
          >
            Join HealthVault as{' '}
            <span className="highlight-primary">
              {roles.find((r) => r.id === role)?.title}.
            </span>
          </h2>

          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              margin: '0 0 24px 0',
            }}
          >
            Choose your profile to authenticate with Ethereum Sepolia.
          </p>

          {/* Role switcher as a visionOS glass pill toggle */}
          <div
            style={{
              display: 'flex',
              padding: '6px',
              borderRadius: 'var(--radius-pill)',
              background: 'rgba(255, 255, 255, 0.65)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.85)',
              outline: '1px solid rgba(35, 128, 113, 0.10)',
              gap: '6px',
              marginBottom: '14px',
            }}
          >
            {roles.map((item) => {
              const isSelected = role === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={loading}
                  onClick={() => setRole(item.id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-pill)',
                    border: isSelected ? '1px solid rgba(255, 255, 255, 0.6)' : '1px solid transparent',
                    background: isSelected ? 'var(--accent-gradient)' : 'transparent',
                    color: isSelected ? '#FFFFFF' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    boxShadow: isSelected ? '0 4px 14px rgba(35, 128, 113, 0.32)' : 'none',
                    transition: 'all var(--duration-fast) var(--ease-spring)',
                  }}
                >
                  <span>{item.icon}</span>
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>

          {/* Selected role description badge */}
          <div
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--primary-tint)',
              border: '1px solid var(--primary-light)',
              color: 'var(--primary-dark)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '28px',
            }}
          >
            <span style={{ fontWeight: 600 }}>{roles.find((r) => r.id === role)?.title}:</span>
            <span>{roles.find((r) => r.id === role)?.text}</span>
          </div>

          {/* Step 02: Connect Button */}
          <span
            className="section-label"
            style={{ marginBottom: '12px' }}
          >
            STEP 02 — WALLET SIGNATURE
          </span>

          <div style={{ marginTop: '8px' }}>
            <PillButton
              size="lg"
              variant="primary"
              onClick={connectWallet}
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center' }}
              icon={<span>⌁</span>}
            >
              {loading ? 'Connecting securely…' : 'Continue with MetaMask →'}
            </PillButton>
          </div>

          {status && (
            <div
              role="status"
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: 'var(--radius-inner)',
                background: 'var(--primary-tint)',
                color: 'var(--primary-dark)',
                fontSize: '12px',
                lineHeight: 1.5,
                textAlign: 'center',
                border: '1px solid var(--primary-light)',
              }}
            >
              {status}
            </div>
          )}

          {/* Agreement Notice under Auth Form */}
          <div
            style={{
              marginTop: '18px',
              fontSize: '11.5px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            By continuing you agree to our{' '}
            <a
              href="/terms"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('terms');
              }}
              style={{
                color: 'var(--primary-dark)',
                fontWeight: 600,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Terms
            </a>{' '}
            and{' '}
            <a
              href="/privacy"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('privacy');
              }}
              style={{
                color: 'var(--primary-dark)',
                fontWeight: 600,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Privacy Policy
            </a>
            .
          </div>

          {/* Zero Passwords Reassurance Footnote */}
          <div
            style={{
              marginTop: '24px',
              padding: '14px 18px',
              borderRadius: 'var(--radius-card-sm)',
              background: 'rgba(255, 255, 255, 0.55)',
              border: '1px solid rgba(255, 255, 255, 0.8)',
              outline: '1px solid rgba(35, 128, 113, 0.08)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--primary-dark)',
                flexShrink: 0,
              }}
            />
            <span>
              <strong>Zero passwords required.</strong> Private keys never leave your device.
              Authentication is validated cryptographically via Ethereum signature.
            </span>
          </div>
        </SpatialCard>
      </main>
    </div>
  );
}
