export default function SectionHeading({
  eyebrow = null,
  titleBlack = '',
  titleHighlight = '',
  highlightType = 'primary', // 'primary' | 'grey'
  description = null,
  align = 'left', // 'left' | 'center' | 'right'
  size = 'lg', // 'sm' | 'md' | 'lg' | 'xl'
  action = null,
  className = '',
  style = {},
}) {
  const fontSizes = {
    sm: 'clamp(20px, 2.5vw, 26px)',
    md: 'clamp(24px, 3.2vw, 36px)',
    lg: 'clamp(32px, 4.5vw, 52px)',
    xl: 'clamp(40px, 5.5vw, 68px)',
  }[size];

  return (
    <div
      className={`section-heading-block ${className}`}
      style={{
        textAlign: align,
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        ...style,
      }}
    >
      {eyebrow && (
        <span
          className="section-label"
          style={{
            marginBottom: '12px',
          }}
        >
          {eyebrow}
        </span>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          width: '100%',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <h2
          className="two-tone-heading"
          style={{
            fontSize: fontSizes,
            margin: 0,
            maxWidth: '850px',
          }}
        >
          {titleBlack}{' '}
          {titleHighlight && (
            <span
              className={highlightType === 'grey' ? 'highlight-grey' : 'highlight-primary'}
            >
              {titleHighlight}
            </span>
          )}
        </h2>
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
      {description && (
        <p
          style={{
            fontSize: '14px',
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            marginTop: '12px',
            marginBottom: 0,
            maxWidth: '620px',
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
