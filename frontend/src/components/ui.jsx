export function StatusMessage({ type = 'info', children }) {
  if (!children) return null;

  const styles = {
    info: {
      background: 'rgba(227, 243, 239, 0.82)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: 'var(--primary-dark, #1A6056)',
      border: '1px solid var(--primary-light, #A8D8CE)',
      boxShadow: 'var(--shadow-sm)',
    },
    success: {
      background: 'rgba(237, 247, 241, 0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: 'var(--status-success-text, #1E6B3E)',
      border: '1px solid var(--status-success-border, #D1EAD9)',
      boxShadow: 'var(--shadow-sm)',
    },
    warning: {
      background: 'rgba(255, 248, 235, 0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: 'var(--status-warning-text, #8C5E08)',
      border: '1px solid var(--status-warning-border, #FFE8BF)',
      boxShadow: 'var(--shadow-sm)',
    },
    error: {
      background: 'rgba(255, 240, 240, 0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: 'var(--status-error-text, #A82424)',
      border: '1px solid var(--status-error-border, #FCD6D6)',
      boxShadow: 'var(--shadow-sm)',
    },
  }[type] || {
    background: 'rgba(255, 255, 255, 0.75)',
    backdropFilter: 'blur(12px)',
    color: '#0E0E10',
    border: '1px solid #E8E8EC',
  };

  return (
    <div
      className={`status-message status-${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      style={{
        ...styles,
        padding: '12px 18px',
        borderRadius: 'var(--radius-inner, 16px)',
        fontSize: '12px',
        lineHeight: 1.6,
        marginBottom: '16px',
        overflowWrap: 'anywhere',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <span style={{ fontSize: '14px', flexShrink: 0 }}>
        {type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}
      </span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export function StatCard({ label, value, detail }) {
  return (
    <div
      className="stat-card spatial-layer-1"
      style={{
        padding: '24px 22px',
        borderRadius: 'var(--radius-spatial-md, 24px)',
        border: '1px solid var(--glass-l1-border)',
        background: 'var(--glass-l1-bg)',
        backdropFilter: 'var(--glass-l1-blur)',
        WebkitBackdropFilter: 'var(--glass-l1-blur)',
        boxShadow: 'var(--glass-l1-shadow)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        transition: 'transform var(--duration-fast, 0.2s) var(--ease-spring), box-shadow var(--duration-fast) ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'var(--specular-highlight)',
          pointerEvents: 'none',
        }}
      />
      <span
        className="stat-label"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-tertiary, #9A9AA2)',
          display: 'block',
          marginBottom: '8px',
        }}
      >
        {label}
      </span>
      <strong
        className="stat-value"
        style={{
          fontSize: 'clamp(26px, 3vw, 36px)',
          fontWeight: 600,
          letterSpacing: '-0.03em',
          color: 'var(--text-primary, #0E0E10)',
          display: 'block',
          lineHeight: 1.1,
        }}
      >
        {value}
      </strong>
      {detail && (
        <small
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary, #6E6E76)',
            marginTop: '8px',
            display: 'block',
          }}
        >
          {detail}
        </small>
      )}
    </div>
  );
}
