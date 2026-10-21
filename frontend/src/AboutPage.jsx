import { useState } from 'react';
import Navbar from './components/common/Navbar';
import SectionHeading from './components/common/SectionHeading';
import PillButton from './components/common/PillButton';
import PillInput from './components/common/PillInput';
import StatGrid from './components/common/StatGrid';
import NumberedTile from './components/common/NumberedTile';
import Timeline from './components/common/Timeline';
import YearPicker from './components/common/YearPicker';
import MarqueeTicker from './components/common/MarqueeTicker';
import HeroVisual from './components/common/HeroVisual';
import SpatialBackground from './components/common/SpatialBackground';
import SpatialCard from './components/common/SpatialCard';
import './About.css';

export default function AboutPage({ onBack, onOpenAuth, onNavigate }) {
  const [activeExplore, setActiveExplore] = useState(null);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleAuth = (targetRole = 'patient') => {
    if (onOpenAuth) {
      onOpenAuth(targetRole);
    } else if (onBack) {
      onBack(targetRole);
    }
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const stats = [
    { label: 'Access Control', value: 'Consent-Led', detail: 'Patient-authorized access for all records' },
    { label: 'Encryption Standard', value: 'AES-256', detail: 'AES-256-GCM encrypted storage' },
    { label: 'Consensus Layer', value: 'On-Chain', detail: 'Public blockchain smart contract consensus' },
    { label: 'Revocation Speed', value: 'Instant', detail: 'On-chain termination in a single block' },
  ];

  const features = [
    {
      num: '01',
      title: 'Encrypted Record Storage',
      tag: 'STORAGE',
      desc: 'Medical records are encrypted on the server with AES-256-GCM before storage. Cryptographic hashes are anchored to Ethereum to verify authenticity.',
      detail: 'Encrypted payloads are accessible strictly upon verified patient permission.',
    },
    {
      num: '02',
      title: 'Time-Bound Access Control',
      tag: 'CONSENT',
      desc: 'Grant doctor access for temporary 5 to 60-minute windows. Consent is recorded on-chain, time limits are enforced by the backend, and downloads are disabled upon expiration or revocation.',
      detail: 'Pre-flight verification ensures no expired viewer ever streams protected bytes.',
    },
    {
      num: '03',
      title: 'Transparent Audit Trail',
      tag: 'VERIFICATION',
      desc: 'Consent events are recorded on-chain, while the audit log is kept by the backend. Distinguish on-chain events from recorded server operations with full transparency.',
      detail: 'Filter by transaction hash, block range, doctor address, and timestamp.',
    },
  ];

  return (
    <div className="app-frame-wrapper">
      <SpatialBackground />
      <div className="app-frame" style={{ position: 'relative', zIndex: 1 }}>
        {/* Minimal Editorial Top Navigation */}
        <Navbar
          onNavigate={(target) => {
            if (target === 'story') scrollToSection('mission-section');
            else if (target === 'how') scrollToSection('how-it-works-section');
            else if (target === 'features') scrollToSection('features-section');
            else if (target === 'privacy') onNavigate && onNavigate('privacy');
            else if (target === 'terms') onNavigate && onNavigate('terms');
            else scrollToSection('hero-section');
          }}
          onOpenAuth={handleAuth}
        />

        {/* 1. HERO SECTION */}
        <section
          id="hero-section"
          style={{
            padding: 'clamp(48px, 6vw, 84px) clamp(24px, 5vw, 64px) 48px',
            maxWidth: '1280px',
            margin: '0 auto',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))',
              gap: '48px',
              alignItems: 'center',
            }}
          >
            {/* Left Hero Copy */}
            <div>
              <span className="section-label" style={{ marginBottom: '16px' }}>
                DECENTRALIZED HEALTH RECORD SYSTEM
              </span>

              <h1
                className="two-tone-heading"
                style={{
                  fontSize: 'clamp(40px, 5.2vw, 68px)',
                  margin: '0 0 20px 0',
                  lineHeight: 1.05,
                }}
              >
                Your health records.{' '}
                <span className="highlight-primary">
                  Secured, shared, and always yours.
                </span>
              </h1>

              <p
                style={{
                  fontSize: '16px',
                  lineHeight: 1.65,
                  color: 'var(--text-secondary)',
                  maxWidth: '520px',
                  margin: '0 0 32px 0',
                }}
              >
                A calm, medical-grade vault for clinical records. Encrypted with
                AES-256-GCM prior to storage, with access governed by your explicit,
                time-limited consent.
              </p>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px',
                  alignItems: 'center',
                  marginBottom: '36px',
                }}
              >
                <PillButton
                  size="lg"
                  variant="primary"
                  onClick={() => handleAuth('patient')}
                  icon={<span>→</span>}
                  iconPosition="right"
                >
                  Enter as Patient
                </PillButton>

                <PillButton
                  size="lg"
                  variant="outline"
                  onClick={() => handleAuth('doctor')}
                >
                  Doctor Workspace
                </PillButton>
              </div>

              {/* Scroll For More Dark Pill */}
              <div
                onClick={() => scrollToSection('mission-section')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--text-primary)',
                  color: 'var(--text-inverted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(14, 14, 16, 0.15)',
                  transition: 'transform var(--duration-fast) ease',
                }}
              >
                <span>Scroll for more</span>
                <span style={{ fontSize: '13px' }}>↓</span>
              </div>
            </div>

            {/* Right Hero Pastel Glass Visual */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <HeroVisual />
            </div>
          </div>

          {/* Floating Glass Strip Under Hero with "01" */}
          <div
            className="spatial-panel"
            style={{
              marginTop: '56px',
              padding: '18px 28px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              borderRadius: 'var(--radius-pill)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--primary-dark)',
              }}
            >
              01
            </span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            >
              Patient-Led Consent Protocol — On-chain authorization with backend-enforced time limits
            </span>
          </div>
        </section>

        {/* 2. MARQUEE TICKER */}
        <MarqueeTicker />

        {/* 3. MISSION & STATS SECTION */}
        <section
          id="mission-section"
          style={{
            padding: 'clamp(64px, 8vw, 100px) clamp(24px, 5vw, 64px)',
            maxWidth: '1280px',
            margin: '0 auto',
          }}
        >
          <div
            style={{
              maxWidth: '860px',
              marginBottom: '56px',
            }}
          >
            <span className="section-label" style={{ marginBottom: '16px' }}>
              OUR MISSION & PHILOSOPHY
            </span>

            <p
              className="two-tone-heading"
              style={{
                fontSize: 'clamp(28px, 4vw, 44px)',
                lineHeight: 1.25,
                margin: 0,
              }}
            >
              Healthcare records are too often fragmented, opaque, and shared without
              genuine consent.{' '}
              <span className="highlight-primary">
                HealthVault gives you direct access control over your medical records.
              </span>
            </p>
          </div>

          {/* Stats Grid in Big-Number Style */}
          <StatGrid stats={stats} />
        </section>

        {/* 4. HOW IT WORKS (Floating Spatial Glass Panel) */}
        <section
          id="how-it-works-section"
          style={{
            padding: '24px clamp(20px, 4vw, 48px)',
            maxWidth: '1280px',
            margin: '0 auto',
          }}
        >
          <div
            className="spatial-panel"
            style={{
              padding: 'clamp(44px, 6vw, 68px) clamp(24px, 5vw, 48px)',
              borderRadius: 'var(--radius-spatial-xl)',
            }}
          >
            <SectionHeading
              eyebrow="PROTOCOL ARCHITECTURE"
              titleBlack="How HealthVault works,"
              titleHighlight="step by step."
              description="From cryptographic wallet authentication to instant on-chain revocation, each transition is verifiable."
              style={{ marginBottom: '40px' }}
            />

            <Timeline />
          </div>
        </section>

        {/* 5. NUMBERED FEATURES SECTION ("01", "02", "03") */}
        <section
          id="features-section"
          style={{
            padding: 'clamp(64px, 8vw, 110px) clamp(24px, 5vw, 64px)',
            maxWidth: '1280px',
            margin: '0 auto',
          }}
        >
          <SectionHeading
            eyebrow="CORE CAPABILITIES"
            titleBlack="Engineered for trust,"
            titleHighlight="refined for humans."
            description="Explore our three foundational pillars protecting sensitive health information."
            style={{ marginBottom: '48px' }}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
              gap: '24px',
            }}
          >
            {features.map((feat) => (
              <NumberedTile
                key={feat.num}
                number={feat.num}
                tag={feat.tag}
                title={feat.title}
                description={feat.desc}
                onExplore={() => setActiveExplore(activeExplore === feat.num ? null : feat.num)}
                exploreText={activeExplore === feat.num ? 'Less' : 'Explore'}
              >
                {activeExplore === feat.num && (
                  <div
                    style={{
                      padding: '12px 14px',
                      background: 'var(--primary-tint)',
                      borderRadius: 'var(--radius-inner)',
                      fontSize: '11px',
                      color: 'var(--primary-dark)',
                      lineHeight: 1.5,
                      marginTop: '8px',
                    }}
                  >
                    {feat.detail}
                  </div>
                )}
              </NumberedTile>
            ))}
          </div>
        </section>

        {/* 6. VERTICAL YEAR PICKER / ROADMAP SECTION (Floating Spatial Glass Panel) */}
        <section
          style={{
            padding: '24px clamp(20px, 4vw, 48px)',
            maxWidth: '1280px',
            margin: '0 auto',
          }}
        >
          <div
            className="spatial-panel"
            style={{
              padding: 'clamp(44px, 6vw, 68px) clamp(24px, 5vw, 48px)',
              borderRadius: 'var(--radius-spatial-xl)',
            }}
          >
            <SectionHeading
              eyebrow="2026 CHRONOLOGY & MILESTONES"
              titleBlack="A trajectory towards"
              titleHighlight="universal patient sovereignty."
              description="Inspect key milestones achieved in 2026 across HealthVault's blockchain verification lifecycle."
              style={{ marginBottom: '32px' }}
            />

            <YearPicker year="2026" />
          </div>
        </section>

        {/* 7. GIANT "GET STARTED" CTA BLOCK WITH OVERLAPPING GLASS CARD */}
        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            padding: 'clamp(72px, 9vw, 130px) clamp(24px, 5vw, 64px)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Giant Oversized Typography in Background */}
          <div
            className="giant-display-text"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: 'clamp(80px, 16vw, 220px)',
              whiteSpace: 'nowrap',
              zIndex: 1,
            }}
          >
            GET STARTED
          </div>

          {/* Overlapping Frosted Glass Card with visionOS 3D Tilt */}
          <SpatialCard
            depth={3}
            maxTilt={6}
            style={{
              position: 'relative',
              zIndex: 2,
              maxWidth: '640px',
              width: '100%',
              padding: 'clamp(36px, 5vw, 56px)',
              borderRadius: 'var(--radius-spatial-xl)',
            }}
          >
            <span
              className="section-label"
              style={{ marginBottom: '14px', justifyContent: 'center' }}
            >
              SECURE ACCESS
            </span>

            <h3
              className="two-tone-heading"
              style={{
                fontSize: 'clamp(28px, 3.6vw, 42px)',
                margin: '0 0 14px 0',
              }}
            >
              Take control of your health story,{' '}
              <span className="highlight-primary">today.</span>
            </h3>

            <p
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                margin: '0 0 32px 0',
              }}
            >
              Connect your MetaMask wallet for on-chain authorization. No passwords,
              no centralized identity leak.
            </p>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '14px',
                justifyContent: 'center',
                marginBottom: '28px',
              }}
            >
              <PillButton
                size="lg"
                variant="primary"
                onClick={() => handleAuth('patient')}
                icon={<span>◉</span>}
              >
                Patient Portal
              </PillButton>

              <PillButton
                size="lg"
                variant="solid"
                onClick={() => handleAuth('doctor')}
                icon={<span>✚</span>}
              >
                Care Provider
              </PillButton>
            </div>

            {/* Newsletter or Updates Pill Input */}
            <div style={{ maxWidth: '420px', margin: '0 auto' }}>
              {subscribed ? (
                <div
                  style={{
                    padding: '10px 16px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--status-success-bg)',
                    color: 'var(--status-success-text)',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  ✓ You will receive protocol updates on network deployments.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <PillInput
                    placeholder="Enter email for network updates"
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                  />
                  <PillButton
                    variant="solid"
                    size="md"
                    onClick={() => {
                      if (newsletterEmail.includes('@')) setSubscribed(true);
                    }}
                  >
                    Send
                  </PillButton>
                </div>
              )}
            </div>
          </SpatialCard>
        </section>

        {/* 8. EDITORIAL MINIMAL FOOTER (Floating Spatial Glass Bar) */}
        <footer
          className="spatial-panel"
          style={{
            maxWidth: '1240px',
            margin: '0 auto 36px',
            padding: '24px clamp(24px, 5vw, 44px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '20px',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            borderRadius: 'var(--radius-spatial-lg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '7px',
                background: 'var(--accent-gradient)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              ✦
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              HealthVault
            </span>
          </div>

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => scrollToSection('mission-section')}
            >
              Mission
            </span>
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => scrollToSection('how-it-works-section')}
            >
              Protocol
            </span>
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => scrollToSection('features-section')}
            >
              Security
            </span>
            <a
              href="/privacy"
              style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}
              onClick={(e) => {
                e.preventDefault();
                onNavigate && onNavigate('privacy');
              }}
            >
              Privacy Policy
            </a>
            <a
              href="/terms"
              style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}
              onClick={(e) => {
                e.preventDefault();
                onNavigate && onNavigate('terms');
              }}
            >
              Terms & Conditions
            </a>
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => handleAuth('patient')}
            >
              Sign In
            </span>
          </div>

          <div>
            © 2026 HealthVault. Sovereign medical records, blockchain-secured.
          </div>
        </footer>
      </div>
    </div>
  );
}
