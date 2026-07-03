import React from 'react';
import styles from './Skeleton.module.css';

const Skeleton = ({ width, height, borderRadius, circle, card, style }) => {
  const classNames = [
    styles.skeleton,
    circle ? styles.circle : '',
    card ? styles.card : ''
  ].filter(Boolean).join(' ');

  return (
    <div 
      className={classNames} 
      style={{ 
        width: circle ? height || width : width, 
        height: circle ? width || height : height, 
        borderRadius: circle ? '50%' : borderRadius, 
        ...style 
      }} 
    />
  );
};

export default Skeleton;
