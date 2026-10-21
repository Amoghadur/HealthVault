export default function StatGrid({
  stats = [],
  className = '',
  style = {},
}) {
  return (
    <div
      className={`stat-grid-editorial ${className}`}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 200px), 1fr))`,
        gap: '20px',
        width: '100%',
        ...style,
      }}
    >
      {stats.map((stat, idx) => (
        <div
          key={idx}
          className="spatial-layer-1"
          style={{
            padding: '24px 22px',
            borderRadius: 'var(--radius-spatial-md)',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            outline: '1px solid rgba(35, 128, 113, 0.10)',
            background: 'rgba(255, 255, 255, 0.65)',
            backdropFilter: 'blur(20px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            boxShadow: 'var(--glass-l1-shadow)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: '130px',
            transition: 'transform var(--duration-fast) var(--ease-spring), box-shadow var(--duration-fast) ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)';
            e.currentTarget.style.boxShadow = 'var(--glass-l2-shadow)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none';
            e.currentTarget.style.boxShadow = 'var(--glass-l1-shadow)';
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-tertiary)',
              display: 'block',
              marginBottom: '10px',
            }}
          >
            {stat.label}
          </span>
          <div
            style={{
              fontSize: 'clamp(28px, 3.2vw, 42px)',
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            {stat.value}
          </div>
          {stat.detail && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                marginTop: '8px',
                lineHeight: 1.4,
              }}
            >
              {stat.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
