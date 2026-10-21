import { useState } from 'react';

const DEFAULT_STEPS = [
  { step: '01', title: 'Register & Connect', desc: 'Secure Ethereum wallet signature creates your cryptographic identity.' },
  { step: '02', title: 'Upload Record', desc: 'Medical files are uploaded to the backend server for processing.' },
  { step: '03', title: 'Encrypt & Hash', desc: 'Files are encrypted with AES-256-GCM before storage; hash is anchored on-chain.' },
  { step: '04', title: 'Grant Access', desc: 'Patient records consent on-chain; backend enforces time-limited access.' },
  { step: '05', title: 'Doctor Views', desc: 'Backend verifies consent and streams decrypted PDF during active window.' },
  { step: '06', title: 'Revoke Anytime', desc: 'Instantly terminate access on-chain. Backend stops further record access.' },
];

export default function Timeline({
  steps = DEFAULT_STEPS,
  className = '',
  style = {},
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div
      className={`horizontal-timeline-container ${className}`}
      style={{
        width: '100%',
        padding: '24px 0',
        ...style,
      }}
    >
      {/* Horizontal Line with Dots */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '36px',
          padding: '0 16px',
        }}
      >
        {/* Track Line */}
        <div
          style={{
            position: 'absolute',
            left: '20px',
            right: '20px',
            height: '2px',
            background: 'var(--border-subtle)',
            zIndex: 1,
          }}
        />

        {/* Progress fill up to active */}
        <div
          style={{
            position: 'absolute',
            left: '20px',
            width: `${(activeIndex / (steps.length - 1)) * 95}%`,
            height: '2px',
            background: 'var(--primary)',
            zIndex: 2,
            transition: 'width var(--duration-normal) var(--ease-spring)',
          }}
        />

        {steps.map((item, idx) => {
          const isActive = idx === activeIndex;
          const isPassed = idx < activeIndex;

          return (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              style={{
                position: 'relative',
                zIndex: 3,
                width: isActive ? '20px' : '14px',
                height: isActive ? '20px' : '14px',
                borderRadius: '50%',
                background: isActive
                  ? 'var(--primary-dark)'
                  : isPassed
                  ? 'var(--primary)'
                  : 'var(--bg-surface)',
                border: `2px solid ${isActive ? 'var(--primary-light)' : isPassed ? 'var(--primary)' : 'var(--border-subtle)'}`,
                boxShadow: isActive ? '0 0 0 6px var(--accent-glow)' : 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'all var(--duration-fast) var(--ease-spring)',
              }}
              aria-label={`Step ${idx + 1}: ${item.title}`}
            />
          );
        })}
      </div>

      {/* Active Step Details Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: '16px',
        }}
      >
        {steps.map((item, idx) => {
          const isActive = idx === activeIndex;

          return (
            <div
              key={idx}
              onClick={() => setActiveIndex(idx)}
              style={{
                padding: '20px',
                borderRadius: 'var(--radius-card-sm)',
                background: isActive ? 'var(--bg-surface)' : 'var(--bg-surface-subtle)',
                border: `1px solid ${isActive ? 'var(--primary-light)' : 'var(--border-subtle)'}`,
                boxShadow: isActive ? 'var(--shadow-card)' : 'none',
                cursor: 'pointer',
                transition: 'all var(--duration-fast) ease',
                opacity: isActive ? 1 : 0.65,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: isActive ? 'var(--primary-dark)' : 'var(--text-tertiary)',
                  }}
                >
                  {item.step}
                </span>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {item.title}
                </span>
              </div>
              <p
                style={{
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: isActive ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  margin: 0,
                }}
              >
                {item.desc}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
