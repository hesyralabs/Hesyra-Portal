import React from 'react';

/**
 * ProgressDots — Reusable step indicator
 *   active  = coral + elongated
 *   completed = navy circle
 *   upcoming = navy-tint
 */
const ProgressDots = ({ total, current, style }) => {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', ...style }}>
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isCompleted = step < current;
        const isActive = step === current;

        return (
          <div
            key={step}
            style={{
              width: isActive ? '22px' : '8px',
              height: '8px',
              borderRadius: isActive ? '3px' : '50%',
              backgroundColor: isActive
                ? '#C9786A'
                : isCompleted
                  ? '#001A33'
                  : '#d9e0e8',
              transition: 'all 300ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
};

export default ProgressDots;
