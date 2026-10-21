const DEFAULT_ITEMS = [
  'SECURE RECORDS',
  'YOU CONTROL ACCESS',
  'BLOCKCHAIN-SECURED CONSENSUS',
  'TRANSPARENT AUDIT TRAIL',
  'INSTANT CONSENT REVOCATION',
  'BACKEND-ENFORCED ACCESS TIMERS',
  'AES-256-GCM ENCRYPTED STORAGE',
];

export default function MarqueeTicker({
  items = DEFAULT_ITEMS,
  speed = '28s',
  className = '',
  style = {},
}) {
  // Duplicate list twice to guarantee seamless infinite loop
  const displayItems = [...items, ...items];

  return (
    <div
      className={`marquee-container ${className}`}
      style={{
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(255, 255, 255, 0.4)',
        ...style,
      }}
      aria-hidden="true"
    >
      <div
        className="marquee-content"
        style={{ animationDuration: speed }}
      >
        {displayItems.map((phrase, idx) => (
          <span className="marquee-item" key={idx}>
            <span>{phrase}</span>
            <span className="marquee-sep">/</span>
            <span className="marquee-icon">⊕</span>
          </span>
        ))}
      </div>
    </div>
  );
}
