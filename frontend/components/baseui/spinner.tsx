import { useState, useEffect } from 'react';

const PixelSpinner = ({ 
  size = 8,
  pixelSize = 3,
  color = 'bg-blue-400',
  speed = 30,
  outerRadius = 4,
  innerRadius = 3,
  gapSize = Math.PI / 2,
  numFrames = 24,
  className = ''
}) => {
  const [frame, setFrame] = useState(0);
  
  const generateSpinnerFrame = (gapAngle: number) => {
    const center = (size - 1) / 2;
    const pattern = Array(size).fill(null).map(() => Array(size).fill(0));
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance >= innerRadius && distance <= outerRadius) {
          let angle = Math.atan2(dy, dx);
          if (angle < 0) angle += 2 * Math.PI;
          
          let normalizedGapAngle = gapAngle;
          if (normalizedGapAngle < 0) normalizedGapAngle += 2 * Math.PI;
          
          let gapStart = normalizedGapAngle - gapSize / 2;
          let gapEnd = normalizedGapAngle + gapSize / 2;
          
          let inGap = false;
          
          if (gapStart < 0) {
            gapStart += 2 * Math.PI;
            inGap = angle >= gapStart || angle <= gapEnd;
          } else if (gapEnd > 2 * Math.PI) {
            gapEnd -= 2 * Math.PI;
            inGap = angle >= gapStart || angle <= gapEnd;
          } else {
            inGap = angle >= gapStart && angle <= gapEnd;
          }
          
          if (!inGap) {
            pattern[y][x] = 1;
          }
        }
      }
    }
    
    return pattern;
  };
  
  const generateFrames = () => {
    const frames = [];
    for (let i = 0; i < numFrames; i++) {
      const gapAngle = (i * 2 * Math.PI) / numFrames;
      frames.push(generateSpinnerFrame(gapAngle));
    }
    return frames;
  };
  
  const frames = generateFrames();
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % numFrames);
    }, speed);
    
    return () => clearInterval(interval);
  }, [numFrames, speed]);
  
  const currentPattern = frames[frame];

  return (
    <div 
      className={`inline-block ${className}`}
      style={{
        width: `${size * pixelSize}px`,
        height: `${size * pixelSize}px`
      }}
    >
      {currentPattern.map((row, rowIndex) => (
        <div key={rowIndex} className="flex">
          {row.map((pixel, colIndex) => (
            <div
              key={`${rowIndex}-${colIndex}`}
              className={pixel === 1 ? color : 'bg-transparent'}
              style={{
                width: `${pixelSize}px`,
                height: `${pixelSize}px`,
                imageRendering: 'pixelated'
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default PixelSpinner;