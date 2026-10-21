import { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * HeroVisual renders the spatial 3D glass orbit visual with interactive parallax tilt.
 * The glass rings, central cryptographic core, and floating badge exist at distinct Z-depths.
 */
export default function HeroVisual({ className = '', style = {} }) {
  const containerRef = useRef(null);
  const [canHover, setCanHover] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const handler = (e) => setCanHover(e.matches);
    media.addEventListener?.('change', handler);
    return () => media.removeEventListener?.('change', handler);
  }, []);

  // Framer Motion spring physics for 3D tilt
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { damping: 25, stiffness: 240, mass: 0.9 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  const rotateX = useTransform(smoothY, [-1, 1], [7, -7]);
  const rotateY = useTransform(smoothX, [-1, 1], [-7, 7]);
  const badgeZ = useTransform(smoothX, [-1, 1], [-8, 8]);

  const handleMouseMove = (e) => {
    if (!canHover || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normX = (x / rect.width) * 2 - 1;
    const normY = (y / rect.height) * 2 - 1;
    mouseX.set(normX);
    mouseY.set(normY);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.div
      ref={containerRef}
      className={`hero-visual-wrapper ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '540px',
        height: '480px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '1200px',
        transformStyle: 'preserve-3d',
        rotateX: canHover ? rotateX : 0,
        rotateY: canHover ? rotateY : 0,
        ...style,
      }}
      aria-label="Abstract glass blockchain and DNA helix structure in medical green"
    >
      {/* Background Soft Green Glow Blobs at Recessed Depth */}
      <div
        style={{
          position: 'absolute',
          width: '320px',
          height: '320px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 216, 206, 0.45) 0%, rgba(227, 243, 239, 0.3) 60%, transparent 80%)',
          filter: 'blur(45px)',
          animation: 'float-slow 8s ease-in-out infinite alternate',
          pointerEvents: 'none',
          transform: 'translateZ(-30px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '260px',
          height: '260px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(35, 128, 113, 0.25) 0%, rgba(245, 245, 246, 0.2) 70%, transparent 80%)',
          filter: 'blur(35px)',
          bottom: '40px',
          right: '30px',
          animation: 'float-slow 10s ease-in-out infinite alternate-reverse',
          pointerEvents: 'none',
          transform: 'translateZ(-20px)',
        }}
      />

      {/* Main 3D Glass SVG Structure at Base Z-Plane */}
      <motion.svg
        viewBox="0 0 500 500"
        style={{
          width: '100%',
          height: '100%',
          filter: 'drop-shadow(0 24px 45px rgba(26, 96, 86, 0.16))',
          animation: 'rotate-hero 24s linear infinite',
          transformOrigin: 'center center',
          transform: 'translateZ(10px)',
        }}
      >
        <defs>
          {/* Glass Gradients in Green Family */}
          <linearGradient id="glassGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="35%" stopColor="#E3F3EF" stopOpacity="0.75" />
            <stop offset="70%" stopColor="#A8D8CE" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#238071" stopOpacity="0.8" />
          </linearGradient>

          <linearGradient id="glassGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E3F3EF" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#7CC4B5" stopOpacity="0.6" />
          </linearGradient>

          <linearGradient id="glassGrad3" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#238071" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#5FB5A5" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#1A6056" stopOpacity="0.8" />
          </linearGradient>

          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Orbit Glass Ring */}
        <circle
          cx="250"
          cy="250"
          r="190"
          fill="none"
          stroke="url(#glassGrad1)"
          strokeWidth="3"
          strokeDasharray="6 12"
          opacity="0.6"
        />

        {/* Orbit Nodes */}
        <circle cx="250" cy="60" r="12" fill="url(#glassGrad3)" filter="url(#softGlow)" />
        <circle cx="250" cy="440" r="8" fill="url(#glassGrad2)" />
        <circle cx="60" cy="250" r="9" fill="url(#glassGrad1)" />
        <circle cx="440" cy="250" r="14" fill="url(#glassGrad3)" filter="url(#softGlow)" />

        {/* Intersecting Torus / Ribbon 1 */}
        <ellipse
          cx="250"
          cy="250"
          rx="170"
          ry="90"
          transform="rotate(35 250 250)"
          fill="none"
          stroke="url(#glassGrad1)"
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Intersecting Torus / Ribbon 2 */}
        <ellipse
          cx="250"
          cy="250"
          rx="170"
          ry="90"
          transform="rotate(-40 250 250)"
          fill="none"
          stroke="url(#glassGrad2)"
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* Central DNA-style Node Core */}
        <circle cx="250" cy="250" r="62" fill="url(#glassGrad1)" opacity="0.9" />
        <circle cx="250" cy="250" r="46" fill="url(#glassGrad3)" opacity="0.35" />
        <circle cx="250" cy="250" r="28" fill="#FFFFFF" opacity="0.95" />
        <circle cx="250" cy="250" r="14" fill="#1A6056" />

        {/* Cryptographic Crosshairs */}
        <line x1="250" y1="210" x2="250" y2="290" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        <line x1="210" y1="250" x2="290" y2="250" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      </motion.svg>

      {/* Floating Glass Pill Badge Elevated at Z=40px with Enhanced Spatial Shadow */}
      <motion.div
        className="spatial-layer-3"
        style={{
          position: 'absolute',
          bottom: '36px',
          right: '-10px',
          padding: '14px 22px',
          borderRadius: 'var(--radius-card-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(32px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(32px) saturate(1.6)',
          border: '1px solid rgba(255, 255, 255, 0.95)',
          outline: '1px solid rgba(35, 128, 113, 0.16)',
          boxShadow: '0 20px 48px rgba(35, 128, 113, 0.22), 0 8px 20px rgba(14, 14, 16, 0.08), inset 0 1px 1px #FFFFFF',
          animation: 'float-slow 7s ease-in-out infinite alternate-reverse',
          transform: 'translateZ(40px)',
          x: canHover ? badgeZ : 0,
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--primary-dark)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cryptographic Access
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          AES-256-GCM Encrypted
        </span>
      </motion.div>

      <style>{`
        @keyframes rotate-hero {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes float-slow {
          0% { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(-12px) rotate(1deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-visual-wrapper svg,
          .hero-visual-wrapper div {
            animation: none !important;
          }
        }
      `}</style>
    </motion.div>
  );
}
