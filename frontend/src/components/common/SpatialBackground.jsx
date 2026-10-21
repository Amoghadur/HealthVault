import { memo } from 'react';

/**
 * SpatialBackground provides Apple visionOS-style atmospheric depth.
 * Renders an animated, slowly shifting multi-stop gradient (using --bg-grad-1 to --bg-grad-5)
 * with large, ultra-soft drifting green ambient light blobs behind glass panels.
 */
function SpatialBackgroundComponent() {
  return (
    <div
      className="spatial-background-container"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: 'var(--spatial-bg-app)',
      }}
    >
      {/* Animated Oversized Multi-Stop Gradient Mesh */}
      <div
        className="spatial-gradient-mesh"
        style={{
          position: 'absolute',
          inset: '-20%',
          width: '140%',
          height: '140%',
          background: `
            radial-gradient(ellipse 60% 50% at 20% 25%, rgba(168, 216, 206, 0.35) 0%, transparent 60%),
            radial-gradient(ellipse 55% 45% at 75% 75%, rgba(95, 181, 165, 0.25) 0%, transparent 60%),
            radial-gradient(ellipse 45% 40% at 50% 50%, var(--bg-grad-accent) 0%, transparent 65%),
            linear-gradient(
              130deg,
              var(--bg-grad-1) 0%,
              var(--bg-grad-2) 20%,
              var(--bg-grad-3) 42%,
              var(--bg-grad-accent) 56%,
              var(--bg-grad-2) 72%,
              rgba(95, 181, 165, 0.18) 86%,
              var(--bg-grad-1) 100%
            )
          `,
          backgroundSize: '300% 300%',
          animation: 'spatial-bg-mesh-loop 22s ease-in-out infinite',
          willChange: 'background-position',
        }}
      />

      {/* Drifting Ambient Light Blob 1 (Top Right) */}
      <div
        className="spatial-blob spatial-blob-1"
        style={{
          position: 'absolute',
          top: '-10%',
          right: '-5%',
          width: 'clamp(400px, 45vw, 750px)',
          height: 'clamp(400px, 45vw, 750px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(35, 128, 113, 0.18) 0%, rgba(95, 181, 165, 0.08) 50%, transparent 72%)',
          filter: 'blur(70px)',
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          animation: 'spatial-drift-1 28s ease-in-out infinite alternate',
        }}
      />

      {/* Drifting Ambient Light Blob 2 (Top Left) */}
      <div
        className="spatial-blob spatial-blob-2"
        style={{
          position: 'absolute',
          top: '15%',
          left: '-8%',
          width: 'clamp(350px, 40vw, 650px)',
          height: 'clamp(350px, 40vw, 650px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124, 196, 181, 0.22) 0%, rgba(168, 216, 206, 0.10) 45%, transparent 70%)',
          filter: 'blur(65px)',
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          animation: 'spatial-drift-2 34s ease-in-out infinite alternate-reverse',
        }}
      />

      {/* Drifting Ambient Light Blob 3 (Center Bottom) */}
      <div
        className="spatial-blob spatial-blob-3"
        style={{
          position: 'absolute',
          bottom: '-12%',
          left: '25%',
          width: 'clamp(450px, 50vw, 850px)',
          height: 'clamp(450px, 50vw, 850px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(35, 128, 113, 0.15) 0%, rgba(95, 181, 165, 0.06) 55%, transparent 75%)',
          filter: 'blur(80px)',
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          animation: 'spatial-drift-3 40s ease-in-out infinite alternate',
        }}
      />

      {/* Drifting Ambient Light Blob 4 (Middle Right) */}
      <div
        className="spatial-blob spatial-blob-4"
        style={{
          position: 'absolute',
          top: '55%',
          right: '5%',
          width: 'clamp(300px, 35vw, 550px)',
          height: 'clamp(300px, 35vw, 550px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 216, 206, 0.18) 0%, rgba(35, 128, 113, 0.08) 50%, transparent 70%)',
          filter: 'blur(60px)',
          transform: 'translate3d(0, 0, 0)',
          willChange: 'transform',
          animation: 'spatial-drift-4 30s ease-in-out infinite alternate-reverse',
        }}
      />

      <style>{`
        @keyframes spatial-bg-mesh-loop {
          0% { background-position: 0% 0%; }
          50% { background-position: 100% 100%; }
          100% { background-position: 0% 0%; }
        }
        @keyframes spatial-drift-1 {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-40px, 50px, 0) scale(1.08); }
          100% { transform: translate3d(30px, -30px, 0) scale(0.95); }
        }
        @keyframes spatial-drift-2 {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(50px, -40px, 0) scale(1.1); }
          100% { transform: translate3d(-30px, 35px, 0) scale(0.92); }
        }
        @keyframes spatial-drift-3 {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-60px, -40px, 0) scale(1.06); }
          100% { transform: translate3d(40px, 20px, 0) scale(0.98); }
        }
        @keyframes spatial-drift-4 {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(-35px, 35px, 0) scale(1.05); }
          100% { transform: translate3d(25px, -45px, 0) scale(0.96); }
        }
        @media (prefers-reduced-motion: reduce) {
          .spatial-gradient-mesh {
            animation: none !important;
            background-position: 50% 50% !important;
          }
          .spatial-blob {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default memo(SpatialBackgroundComponent);
