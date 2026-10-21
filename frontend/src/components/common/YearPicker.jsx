import { useState } from 'react';

const DEFAULT_2026_MILESTONES = [
  {
    period: 'Q1',
    quarter: 'Q1 2026',
    year: '2026',
    label: 'Architecture & Smart Contracts',
    title: 'Planning & On-Chain Deployment',
    caption: 'FIG 1.0 — On-chain patient access registry deployed and verified',
    badge: 'Smart Contract',
    tag: 'On-Chain Registry',
    text: 'Formalized the decentralized HealthVault EHR architecture and deployed the core access control smart contract on-chain, establishing verifiable on-chain grant and revocation mappings.',
    accent: 'rgba(35, 128, 113, 0.12)',
  },
  {
    period: 'Q2',
    quarter: 'Q2 2026',
    year: '2026',
    label: 'Cryptographic Storage',
    title: 'AES-256 Encrypted Upload Pipeline',
    caption: 'FIG 2.0 — AES-256-GCM encrypted storage pipeline with IV and authentication tags',
    badge: 'AES-256-GCM',
    tag: 'AES-256-GCM encrypted storage',
    text: 'Engineered server-side AES-256-GCM file encryption with randomized initialization vectors and authentication tags, ensuring medical records are encrypted prior to persistent storage and authorized byte streaming.',
    accent: 'rgba(35, 128, 113, 0.15)',
  },
  {
    period: 'Q3',
    quarter: 'Q3 2026',
    year: '2026',
    label: 'Consent & Governance',
    title: 'Time-Bound Access Control & Audit Trail',
    caption: 'FIG 3.0 — On-chain consent with backend auto-expiry and transparent audit logging',
    badge: 'Granular Consent',
    tag: 'Auto-Expiry Engine',
    text: 'Introduced granular duration-based consent granting with backend countdown expiry, instant on-chain revocation, emergency access token verification, and an audit logging engine.',
    accent: 'rgba(35, 128, 113, 0.15)',
  },
  {
    period: 'Q4',
    quarter: 'Q4 2026',
    year: '2026',
    label: 'Interface & Verification',
    title: 'Frontend Redesign & Full-Stack Testing',
    caption: 'FIG 4.0 — Serene editorial interface and 31 passing tests',
    badge: 'Production Build',
    tag: '31/31 Tests Passing',
    text: 'Delivered the minimal white and green editorial frontend redesign with smooth Lenis momentum scrolling, live doctor preflight access checks, and confirmed 31 passing tests with zero backend regressions.',
    accent: 'rgba(35, 128, 113, 0.20)',
  },
];

export default function YearPicker({
  year = '2026',
  items = DEFAULT_2026_MILESTONES,
  className = '',
  style = {},
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const activeItem = items[selectedIdx] || items[0];

  return (
    <div
      className={`vertical-year-picker ${className}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 1fr) 2fr',
        gap: '36px',
        alignItems: 'center',
        padding: '32px 0',
        ...style,
      }}
    >
      {/* 2026 Indicator & Quarter Buttons */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ marginBottom: '6px' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--primary-dark)',
              background: 'var(--primary-tint)',
              padding: '5px 12px',
              borderRadius: 'var(--radius-pill)',
              display: 'inline-block',
            }}
          >
            {year} Milestones
          </span>
        </div>

        {items.map((item, idx) => {
          const isSelected = idx === selectedIdx;
          const displayLabel = item.period || item.quarter || item.year;

          return (
            <button
              key={displayLabel || idx}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              style={{
                background: 'none',
                border: 'none',
                textAlign: 'left',
                padding: '4px 0',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: isSelected ? 'clamp(36px, 4vw, 54px)' : 'clamp(20px, 2.2vw, 28px)',
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                lineHeight: 1.1,
                letterSpacing: '-0.04em',
                transition: 'all var(--duration-fast) var(--ease-spring)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              {isSelected && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    boxShadow: '0 0 10px rgba(35, 128, 113, 0.7)',
                  }}
                />
              )}
              <span>{displayLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Milestone Info Card with Image Panel & Caption */}
      <div
        className="glass-card"
        style={{
          padding: '36px',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          position: 'relative',
        }}
      >
        {/* Editorial Image / Graphic Panel */}
        <div
          style={{
            position: 'relative',
            borderRadius: 'var(--radius-inner)',
            background: 'linear-gradient(135deg, rgba(168, 216, 206, 0.35) 0%, rgba(245, 245, 246, 0.9) 100%)',
            border: '1px solid var(--border-subtle)',
            padding: '24px',
            minHeight: '140px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden',
            marginBottom: '16px',
          }}
        >
          {/* Subtle Ambient Glow */}
          <div
            style={{
              position: 'absolute',
              top: '-30px',
              right: '-30px',
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(35, 128, 113, 0.25) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />

          {/* Top Panel Badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--primary-dark)',
                background: 'rgba(255, 255, 255, 0.85)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {activeItem.badge}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-secondary)',
                background: 'rgba(255, 255, 255, 0.65)',
                padding: '3px 8px',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              {activeItem.tag}
            </span>
          </div>

          {/* Bottom Panel Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              zIndex: 1,
              marginTop: '28px',
            }}
          >
            <span
              style={{
                fontSize: '32px',
                fontWeight: 700,
                letterSpacing: '-0.04em',
                color: 'var(--text-primary)',
                lineHeight: 1,
              }}
            >
              {activeItem.period || activeItem.quarter}
            </span>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--text-muted)',
              }}
            >
              {year}
            </span>
          </div>
        </div>

        {/* Milestone Caption */}
        <div
          style={{
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            marginBottom: '18px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {activeItem.caption}
        </div>

        {/* Text Details */}
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--primary-dark)',
            display: 'block',
            marginBottom: '8px',
          }}
        >
          {activeItem.label}
        </span>
        <h3
          style={{
            fontSize: '22px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 12px 0',
            color: 'var(--text-primary)',
          }}
        >
          {activeItem.title}
        </h3>
        <p
          style={{
            fontSize: '14px',
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
          {activeItem.text}
        </p>
      </div>
    </div>
  );
}
