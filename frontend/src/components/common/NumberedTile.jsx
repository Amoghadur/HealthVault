import PillButton from './PillButton';
import SpatialCard from './SpatialCard';

export default function NumberedTile({
  number = '01',
  title = '',
  description = '',
  tag = 'FEATURE',
  exploreText = 'Explore',
  onExplore,
  children,
  className = '',
  style = {},
}) {
  return (
    <SpatialCard
      depth={2}
      className={`numbered-tile ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '340px',
        padding: '32px',
        ...style,
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '20px',
          }}
        >
          <span className="numbered-numeral">{number}</span>
          {tag && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '4px 10px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--primary-tint)',
                color: 'var(--primary-dark)',
              }}
            >
              {tag}
            </span>
          )}
        </div>

        <h3
          style={{
            fontSize: '20px',
            fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)',
            margin: '0 0 10px 0',
          }}
        >
          {title}
        </h3>

        <p
          style={{
            fontSize: '13px',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
          {description}
        </p>
      </div>

      <div
        style={{
          marginTop: '28px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {children ? (
          <div>{children}</div>
        ) : (
          <div />
        )}
        {onExplore && (
          <PillButton
            size="sm"
            variant="outline"
            onClick={onExplore}
            icon={<span>→</span>}
            iconPosition="right"
          >
            {exploreText}
          </PillButton>
        )}
      </div>
    </SpatialCard>
  );
}
