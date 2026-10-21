import { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/**
 * SpatialCard implements Apple visionOS interactive 3D tilt with cursor-following specular sheen.
 * Only activates on desktop pointer devices; gracefully degrades to static glass panel on touch.
 */
export default function SpatialCard({
  children,
  className = '',
  style = {},
  depth = 2,
  maxTilt = 6,
  enableTilt = true,
  delay = 0,
  onClick,
  ...rest
}) {
  const cardRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
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

  // Motion values for tilt calculation
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const sheenX = useMotionValue(0);
  const sheenY = useMotionValue(0);

  // Smooth spring physics for natural visionOS weight
  const springConfig = { damping: 25, stiffness: 260, mass: 0.8 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  const rotateX = useTransform(smoothY, [-1, 1], [maxTilt, -maxTilt]);
  const rotateY = useTransform(smoothX, [-1, 1], [-maxTilt, maxTilt]);

  const sheenGradient = useTransform(
    [sheenX, sheenY],
    ([x, y]) =>
      `radial-gradient(circle 320px at ${x}px ${y}px, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.12) 40%, transparent 75%)`
  );

  const handleMouseMove = (e) => {
    if (!enableTilt || !canHover || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const normX = (x / rect.width) * 2 - 1;
    const normY = (y / rect.height) * 2 - 1;

    mouseX.set(normX);
    mouseY.set(normY);
    sheenX.set(x);
    sheenY.set(y);
  };

  const handleMouseEnter = () => {
    if (canHover) setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    mouseX.set(0);
    mouseY.set(0);
  };

  const depthClass = `spatial-layer-${depth}`;

  return (
    <motion.div
      ref={cardRef}
      className={`spatial-card ${depthClass} ${className}`}
      initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{
        duration: 0.6,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        position: 'relative',
        transformStyle: 'preserve-3d',
        perspective: 1000,
        rotateX: enableTilt && canHover ? rotateX : 0,
        rotateY: enableTilt && canHover ? rotateY : 0,
        scale: isHovered && enableTilt && canHover ? 1.012 : 1,
        ...style,
      }}
      {...rest}
    >
      {/* Dynamic Specular Sheen that follows cursor on hover */}
      {enableTilt && canHover && (
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 3,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.25s ease',
            background: sheenGradient,
          }}
        />
      )}

      {children}
    </motion.div>
  );
}
