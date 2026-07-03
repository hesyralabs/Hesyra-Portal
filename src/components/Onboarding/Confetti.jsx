import React, { useEffect, useState, useCallback } from 'react';

const COLORS = [
  '#C9786A', '#001A33', '#748C98', '#b06054', '#d9e0e8',
  '#f5e1dc', '#0a2a4a', '#C9786A', '#001A33', '#748C98',
];

/**
 * Confetti — ~36 rectangles bursting from center, auto-cleanup.
 * Pure CSS animation, no libraries.
 */
const Confetti = ({ onComplete }) => {
  const [particles, setParticles] = useState([]);

  const generate = useCallback(() => {
    const items = [];
    for (let i = 0; i < 36; i++) {
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const velocity = 300 + Math.random() * 400;
      const x = Math.cos(angle) * velocity;
      const y = Math.sin(angle) * velocity - 200; // bias upward
      items.push({
        id: i,
        x,
        y,
        rotation: Math.random() * 720 - 360,
        color: COLORS[i % COLORS.length],
        width: 6 + Math.random() * 6,
        height: 10 + Math.random() * 10,
        delay: Math.random() * 200,
      });
    }
    setParticles(items);
  }, []);

  useEffect(() => {
    generate();
    const timer = setTimeout(() => {
      setParticles([]);
      onComplete?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [generate, onComplete]);

  if (particles.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 600,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '40%',
            width: `${p.width}px`,
            height: `${p.height}px`,
            backgroundColor: p.color,
            borderRadius: '2px',
            animation: `confetti-burst 1.8s ${p.delay}ms cubic-bezier(0.32, 0.72, 0, 1) forwards`,
            '--confetti-x': `${p.x}px`,
            '--confetti-y': `${p.y}px`,
            '--confetti-rot': `${p.rotation}deg`,
            opacity: 0,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-burst {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: translate(var(--confetti-x), var(--confetti-y)) rotate(var(--confetti-rot));
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default Confetti;
