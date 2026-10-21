import { useState } from 'react';

export default function CardCarousel({
  cards = [],
  renderCard,
  className = '',
  style = {},
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const prev = () => {
    setActiveIndex((current) => (current === 0 ? cards.length - 1 : current - 1));
  };

  const next = () => {
    setActiveIndex((current) => (current === cards.length - 1 ? 0 : current + 1));
  };

  if (!cards.length) return null;

  return (
    <div
      className={`card-carousel-wrapper ${className}`}
      style={{
        width: '100%',
        position: 'relative',
        perspective: '1200px',
        ...style,
      }}
    >
      {/* Cards Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 280px), 1fr))`,
          gap: '24px',
          padding: '20px 6px',
          perspective: '1000px',
        }}
      >
        {cards.map((card, idx) => {
          const isActive = idx === activeIndex;

          return (
            <div
              key={card.id || idx}
              onClick={() => setActiveIndex(idx)}
              className={`glass-card ${isActive ? 'spatial-card-active' : 'spatial-card-inactive'}`}
              style={{
                borderRadius: 'var(--radius-spatial-lg)',
                padding: '28px',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                border: isActive
                  ? '1px solid rgba(35, 128, 113, 0.45)'
                  : '1px solid var(--glass-l1-border)',
                background: isActive ? 'var(--glass-l2-bg)' : 'var(--glass-l1-bg)',
                backdropFilter: isActive ? 'var(--glass-l2-blur)' : 'var(--glass-l1-blur)',
                WebkitBackdropFilter: isActive ? 'var(--glass-l2-blur)' : 'var(--glass-l1-blur)',
                transform: isActive
                  ? 'translateY(-10px) scale(1.04) translateZ(24px)'
                  : 'scale(0.96) translateZ(-8px)',
                zIndex: isActive ? 10 : 1,
                opacity: isActive ? 1 : 0.76,
                filter: isActive ? 'none' : 'blur(0.5px)',
                boxShadow: isActive ? 'var(--glass-l3-shadow)' : 'var(--glass-l1-shadow)',
                transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* Top specular highlight */}
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

              {/* Green gradient overlay on active card */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '160px',
                    height: '160px',
                    background: 'radial-gradient(circle at top right, rgba(35, 128, 113, 0.22), transparent 70%)',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {renderCard ? renderCard(card, isActive) : (
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: 'var(--primary-dark)',
                    }}
                  >
                    {card.tag || `ITEM ${idx + 1}`}
                  </span>
                  <h4
                    style={{
                      fontSize: '18px',
                      fontWeight: 600,
                      margin: '8px 0',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {card.title}
                  </h4>
                  <p
                    style={{
                      fontSize: '13px',
                      lineHeight: 1.5,
                      color: 'var(--text-secondary)',
                      margin: 0,
                    }}
                  >
                    {card.text || card.description}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Prev / Next controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '10px',
          marginTop: '18px',
        }}
      >
        <button
          type="button"
          onClick={prev}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid var(--glass-l1-border)',
            background: 'var(--glass-l1-bg)',
            backdropFilter: 'var(--glass-l1-blur)',
            WebkitBackdropFilter: 'var(--glass-l1-blur)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all var(--duration-fast) var(--ease-spring)',
          }}
          aria-label="Previous card"
        >
          ←
        </button>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--text-tertiary)',
            padding: '0 4px',
          }}
        >
          {activeIndex + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={next}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid var(--glass-l1-border)',
            background: 'var(--glass-l1-bg)',
            backdropFilter: 'var(--glass-l1-blur)',
            WebkitBackdropFilter: 'var(--glass-l1-blur)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all var(--duration-fast) var(--ease-spring)',
          }}
          aria-label="Next card"
        >
          →
        </button>
      </div>
    </div>
  );
}
