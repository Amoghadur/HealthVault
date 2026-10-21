import PillButton from './PillButton';

export default function EmptyState({
  icon = '◌',
  title = 'No records found',
  description = 'Your vault is clear. Items will appear here once registered or shared.',
  actionText = null,
  onAction = null,
  className = '',
  style = {},
}) {
  return (
    <div
      className={`editorial-empty-state ${className}`}
      style={{
        padding: '56px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-surface-subtle)',
        borderRadius: 'var(--radius-card-sm)',
        border: '1px dashed var(--border-subtle)',
        ...style,
      }}
    >
      <div
        style={{
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: 'var(--primary-tint)',
          color: 'var(--primary-dark)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          marginBottom: '16px',
        }}
      >
        {icon}
      </div>

      <h4
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          margin: '0 0 8px 0',
        }}
      >
        {title}
      </h4>

      <p
        style={{
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          maxWidth: '360px',
          margin: 0,
        }}
      >
        {description}
      </p>

      {actionText && onAction && (
        <div style={{ marginTop: '20px' }}>
          <PillButton
            size="sm"
            variant="outline"
            onClick={onAction}
          >
            {actionText}
          </PillButton>
        </div>
      )}
    </div>
  );
}
