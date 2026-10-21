import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle = null,
  children,
  maxWidth = '680px',
  className = '',
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen && typeof document !== 'undefined') {
      const prevBodyOverflow = document.body.style.overflow;
      const prevHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overflow = prevHtmlOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const modalNode = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'rgba(14, 14, 16, 0.55)',
        backdropFilter: 'blur(20px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
        animation: 'spatial-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={onClose}
    >
      <div
        className={`glass-card spatial-modal-window ${className}`}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(36px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.5)',
          borderRadius: 'var(--radius-spatial-xl)',
          border: '1px solid rgba(255, 255, 255, 0.95)',
          padding: '36px',
          boxShadow: '0 0 0 1px rgba(35, 128, 113, 0.12), 0 28px 70px rgba(14, 14, 16, 0.18), 0 12px 32px rgba(35, 128, 113, 0.16)',
          position: 'relative',
          animation: 'spatial-modal-scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-edge specular highlight */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'var(--specular-highlight)',
            pointerEvents: 'none',
            borderTopLeftRadius: 'inherit',
            borderTopRightRadius: 'inherit',
          }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '24px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: '22px',
                fontWeight: 600,
                letterSpacing: 'var(--tracking-tight)',
                margin: 0,
                color: 'var(--text-primary)',
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  marginTop: '4px',
                  marginBottom: 0,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              border: '1px solid var(--glass-l1-border)',
              background: 'var(--glass-l1-bg)',
              backdropFilter: 'var(--glass-l1-blur)',
              WebkitBackdropFilter: 'var(--glass-l1-blur)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '15px',
              color: 'var(--text-secondary)',
              transition: 'all var(--duration-fast) var(--ease-spring)',
              boxShadow: 'var(--shadow-sm)',
            }}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      </div>

      <style>{`
        @keyframes spatial-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spatial-modal-scale-in {
          from { transform: translateY(18px) scale(0.94); opacity: 0; filter: blur(8px); }
          to { transform: translateY(0) scale(1); opacity: 1; filter: blur(0px); }
        }
      `}</style>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modalNode, document.body)
    : modalNode;
}
