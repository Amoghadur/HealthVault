import { useState } from 'react';
import PillButton from './PillButton';

export default function Navbar({
  role = null,
  account = null,
  onNavigate,
  onDisconnect,
  onOpenAuth,
  className = '',
  style = {},
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className={`app-navbar spatial-layer-3 ${className}`}
      style={{
        width: 'calc(100% - 32px)',
        maxWidth: '1240px',
        margin: '16px auto 0',
        padding: '12px 26px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid rgba(255, 255, 255, 0.85)',
        outline: '1px solid rgba(35, 128, 113, 0.12)',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(32px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.5)',
        boxShadow: '0 12px 36px rgba(14, 14, 16, 0.04), 0 24px 60px rgba(35, 128, 113, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.95)',
        position: 'sticky',
        top: '16px',
        zIndex: 100,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {/* Left: Brand Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          cursor: 'pointer',
        }}
        onClick={() => onNavigate && onNavigate('home')}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontSize: '15px',
            fontWeight: 700,
            boxShadow: '0 4px 12px rgba(35, 128, 113, 0.28)',
          }}
        >
          ✦
        </div>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '18px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
          }}
        >
          HealthVault
        </span>
      </div>

      {/* Center: "Menu" with two thin lines (from reference video) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '28px',
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: 'none',
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
            transition: 'background var(--duration-fast) ease',
          }}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation menu"
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
            }}
          >
            Menu
          </span>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              width: '18px',
            }}
          >
            <span
              style={{
                display: 'block',
                width: '18px',
                height: '1.5px',
                background: 'var(--text-primary)',
                borderRadius: '1px',
              }}
            />
            <span
              style={{
                display: 'block',
                width: '18px',
                height: '1.5px',
                background: 'var(--text-primary)',
                borderRadius: '1px',
              }}
            />
          </div>
        </button>

        {/* Quick links for desktop */}
        <nav
          style={{
            display: 'none',
          }}
          className="desktop-nav-links"
        >
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('story')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Mission
          </button>
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('how')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Protocol
          </button>
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('features')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Security
          </button>
        </nav>
      </div>

      {/* Right: Search icon + small round icon button / Auth buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {/* Search icon button */}
        <button
          type="button"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'border-color var(--duration-fast) ease',
          }}
          aria-label="Search records or help"
        >
          🔍
        </button>

        {/* Small round icon button (from reference video) */}
        <button
          type="button"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary-dark)',
            fontSize: '14px',
            cursor: 'pointer',
          }}
          aria-label="HealthVault network status"
          title="Blockchain Network Connected"
        >
          ⌁
        </button>

        {/* Auth status or Connect CTA */}
        {account ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--primary)',
                }}
              />
              <span>
                {account.slice(0, 6)}…{account.slice(-4)}
              </span>
              {role && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-pill)',
                    background: 'var(--primary-tint)',
                    color: 'var(--primary-dark)',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    marginLeft: '4px',
                  }}
                >
                  {role}
                </span>
              )}
            </div>

            {onDisconnect && (
              <PillButton
                size="sm"
                variant="outline"
                onClick={onDisconnect}
              >
                Sign out
              </PillButton>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <PillButton
              size="sm"
              variant="outline"
              onClick={() => onOpenAuth && onOpenAuth('patient')}
            >
              Back to app →
            </PillButton>
            <PillButton
              size="sm"
              variant="primary"
              onClick={() => onOpenAuth && onOpenAuth('doctor')}
            >
              Doctor Login
            </PillButton>
          </div>
        )}
      </div>

      {/* Floating dropdown mobile menu overlay */}
      {menuOpen && (
        <div
          className="spatial-layer-3"
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            left: 0,
            right: 0,
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(32px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.5)',
            border: '1px solid rgba(255, 255, 255, 0.9)',
            outline: '1px solid rgba(35, 128, 113, 0.12)',
            borderRadius: 'var(--radius-card)',
            padding: '24px 28px',
            boxShadow: 'var(--glass-l3-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            zIndex: 100,
          }}
        >
          <button
            type="button"
            onClick={() => { onNavigate && onNavigate('story'); setMenuOpen(false); }}
            style={{ textAlign: 'left', background: 'none', border: 'none', fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Our Mission & Architecture
          </button>
          <button
            type="button"
            onClick={() => { onNavigate && onNavigate('how'); setMenuOpen(false); }}
            style={{ textAlign: 'left', background: 'none', border: 'none', fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Consent & Encryption Protocol
          </button>
          <button
            type="button"
            onClick={() => { onNavigate && onNavigate('features'); setMenuOpen(false); }}
            style={{ textAlign: 'left', background: 'none', border: 'none', fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            Security & Audit Verification
          </button>
          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 0' }} />
          <button
            type="button"
            onClick={() => { onNavigate && onNavigate('privacy'); setMenuOpen(false); }}
            style={{ textAlign: 'left', background: 'none', border: 'none', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => { onNavigate && onNavigate('terms'); setMenuOpen(false); }}
            style={{ textAlign: 'left', background: 'none', border: 'none', fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Terms & Conditions
          </button>
          {!account && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <PillButton
                size="md"
                variant="outline"
                onClick={() => { onOpenAuth && onOpenAuth('patient'); setMenuOpen(false); }}
              >
                Patient Portal
              </PillButton>
              <PillButton
                size="md"
                variant="primary"
                onClick={() => { onOpenAuth && onOpenAuth('doctor'); setMenuOpen(false); }}
              >
                Doctor Workspace
              </PillButton>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
