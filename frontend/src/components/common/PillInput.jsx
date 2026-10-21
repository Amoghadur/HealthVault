export default function PillInput({
  label,
  icon = null,
  suffix = null,
  error = null,
  className = '',
  id,
  ...props
}) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className={`pill-input-group ${className}`} style={{ width: '100%' }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
            marginBottom: '6px',
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {icon && (
          <span
            style={{
              position: 'absolute',
              left: '18px',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              color: 'var(--text-tertiary)',
            }}
          >
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className="pill-input"
          style={{
            paddingLeft: icon ? '44px' : '20px',
            paddingRight: suffix ? '44px' : '20px',
            borderColor: error ? 'var(--status-error-border)' : undefined,
          }}
          {...props}
        />
        {suffix && (
          <span
            style={{
              position: 'absolute',
              right: '16px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p
          role="alert"
          style={{
            margin: '6px 0 0 16px',
            fontSize: '11px',
            color: 'var(--status-error-text)',
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
