import { useEffect, useState } from 'react';

export interface PlantLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  speed?: 'slow' | 'normal' | 'fast';
  className?: string;
}

const sizeMap = {
  sm: 'w-16 h-16',
  md: 'w-24 h-24',
  lg: 'w-32 h-32',
};

const speedMap = {
  slow: '3s',
  normal: '2s',
  fast: '1.5s',
};

export const PlantLoader: React.FC<PlantLoaderProps> = ({
  size = 'md',
  speed = 'normal',
  className = ''
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  if (prefersReducedMotion) {
    return <StaticPlantIcon size={size} className={className} />;
  }

  const animationDuration = speedMap[speed];

  return (
    <div className={`plant-loader ${sizeMap[size]} ${className} relative`}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        style={{
          animation: `plant-lifecycle ${animationDuration} ease-in-out infinite`,
        }}
      >
        <defs>
          {/* Gradients for depth */}
          <linearGradient id="seedGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6B3410" />
            <stop offset="50%" stopColor="#8B4513" />
            <stop offset="100%" stopColor="#5A2D0C" />
          </linearGradient>
          <linearGradient id="stemGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2D5A2B" />
            <stop offset="50%" stopColor="#3F7D3A" />
            <stop offset="100%" stopColor="#2D5A2B" />
          </linearGradient>
          <linearGradient id="leafGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4A9045" />
            <stop offset="50%" stopColor="#3F7D3A" />
            <stop offset="100%" stopColor="#2D5A2B" />
          </linearGradient>
          <radialGradient id="petalGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD54F" />
            <stop offset="70%" stopColor="#F4C430" />
            <stop offset="100%" stopColor="#E0B020" />
          </radialGradient>
          <radialGradient id="centerGradient" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#E8B84D" />
            <stop offset="50%" stopColor="#D4A520" />
            <stop offset="100%" stopColor="#B8860B" />
          </radialGradient>
          {/* Shadow filter */}
          <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" />
            <feOffset dx="0" dy="1" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.3" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Stage 1: Seed in dirt (0-25%) */}
        <g className="stage-1" filter="url(#softShadow)">
          <ellipse
            cx="50"
            cy="68"
            rx="7"
            ry="10"
            fill="url(#seedGradient)"
          />
          {/* Seed texture lines */}
          <path
            d="M 50 60 Q 48 64 50 68"
            stroke="#5A2D0C"
            strokeWidth="0.5"
            fill="none"
            opacity="0.6"
          />
          <path
            d="M 50 60 Q 52 64 50 68"
            stroke="#5A2D0C"
            strokeWidth="0.5"
            fill="none"
            opacity="0.6"
          />
        </g>

        {/* Stage 2: Small seedling (25-50%) */}
        <g className="stage-2" filter="url(#softShadow)">
          {/* Short stem */}
          <line
            x1="50"
            y1="70"
            x2="50"
            y2="55"
            stroke="#3F7D3A"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* First pair of small leaves */}
          <ellipse
            cx="45"
            cy="58"
            rx="6"
            ry="4"
            fill="url(#leafGradient)"
            transform="rotate(-20 45 58)"
          />
          <path
            d="M 45 58 L 41 58"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
          <ellipse
            cx="55"
            cy="58"
            rx="6"
            ry="4"
            fill="url(#leafGradient)"
            transform="rotate(20 55 58)"
          />
          <path
            d="M 55 58 L 59 58"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
        </g>

        {/* Stage 3: Bigger seedling with two sets of leaves (50-75%) */}
        <g className="stage-3" filter="url(#softShadow)">
          {/* Taller stem */}
          <line
            x1="50"
            y1="70"
            x2="50"
            y2="40"
            stroke="#3F7D3A"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Lower pair of leaves (larger) */}
          <ellipse
            cx="40"
            cy="55"
            rx="9"
            ry="5"
            fill="url(#leafGradient)"
            transform="rotate(-25 40 55)"
          />
          <path
            d="M 40 55 L 34 55 M 40 55 L 37 53 M 40 55 L 37 57"
            stroke="#2D5A2B"
            strokeWidth="0.5"
            opacity="0.5"
          />
          <ellipse
            cx="60"
            cy="55"
            rx="9"
            ry="5"
            fill="url(#leafGradient)"
            transform="rotate(25 60 55)"
          />
          <path
            d="M 60 55 L 66 55 M 60 55 L 63 53 M 60 55 L 63 57"
            stroke="#2D5A2B"
            strokeWidth="0.5"
            opacity="0.5"
          />
          {/* Upper pair of leaves (medium) */}
          <ellipse
            cx="44"
            cy="45"
            rx="7"
            ry="4"
            fill="url(#leafGradient)"
            transform="rotate(-15 44 45)"
          />
          <path
            d="M 44 45 L 39 45"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
          <ellipse
            cx="56"
            cy="45"
            rx="7"
            ry="4"
            fill="url(#leafGradient)"
            transform="rotate(15 56 45)"
          />
          <path
            d="M 56 45 L 61 45"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
        </g>

        {/* Stage 4: Flower (75-100%) */}
        <g className="stage-4" filter="url(#softShadow)">
          {/* Full stem */}
          <line
            x1="50"
            y1="70"
            x2="50"
            y2="30"
            stroke="#3F7D3A"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* Lower leaves */}
          <ellipse
            cx="40"
            cy="55"
            rx="10"
            ry="6"
            fill="url(#leafGradient)"
            transform="rotate(-25 40 55)"
          />
          <path
            d="M 40 55 L 33 55 M 40 55 L 36 53 M 40 55 L 36 57"
            stroke="#2D5A2B"
            strokeWidth="0.5"
            opacity="0.5"
          />
          <ellipse
            cx="60"
            cy="55"
            rx="10"
            ry="6"
            fill="url(#leafGradient)"
            transform="rotate(25 60 55)"
          />
          <path
            d="M 60 55 L 67 55 M 60 55 L 64 53 M 60 55 L 64 57"
            stroke="#2D5A2B"
            strokeWidth="0.5"
            opacity="0.5"
          />
          {/* Upper leaves */}
          <ellipse
            cx="44"
            cy="42"
            rx="8"
            ry="5"
            fill="url(#leafGradient)"
            transform="rotate(-15 44 42)"
          />
          <path
            d="M 44 42 L 38 42"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
          <ellipse
            cx="56"
            cy="42"
            rx="8"
            ry="5"
            fill="url(#leafGradient)"
            transform="rotate(15 56 42)"
          />
          <path
            d="M 56 42 L 62 42"
            stroke="#2D5A2B"
            strokeWidth="0.4"
            opacity="0.5"
          />
          {/* Flower petals */}
          <circle cx="50" cy="30" r="8" fill="url(#petalGradient)" />
          <circle cx="42" cy="30" r="6" fill="url(#petalGradient)" />
          <circle cx="58" cy="30" r="6" fill="url(#petalGradient)" />
          <circle cx="50" cy="23" r="6" fill="url(#petalGradient)" />
          <circle cx="50" cy="37" r="6" fill="url(#petalGradient)" />
          {/* Flower center */}
          <circle cx="50" cy="30" r="4" fill="url(#centerGradient)" />
          <circle cx="48" cy="29" r="0.5" fill="#E8B84D" opacity="0.8" />
          <circle cx="52" cy="29" r="0.5" fill="#E8B84D" opacity="0.8" />
          <circle cx="50" cy="31" r="0.5" fill="#B8860B" opacity="0.6" />
        </g>

        {/* Soil line */}
        <line
          x1="30"
          y1="70"
          x2="70"
          y2="70"
          stroke="#6B3410"
          strokeWidth="3"
          opacity="0.4"
        />
        <line
          x1="30"
          y1="70"
          x2="70"
          y2="70"
          stroke="#8B4513"
          strokeWidth="2"
        />
      </svg>

      <style>{`
        @keyframes plant-lifecycle {
          0% {
            transform: scale(0.3) translateY(10px);
            opacity: 0.8;
          }
          25% {
            transform: scale(0.5) translateY(5px);
            opacity: 1;
          }
          50% {
            transform: scale(0.75) translateY(0);
            opacity: 1;
          }
          75% {
            transform: scale(0.9) translateY(-5px);
            opacity: 1;
          }
          100% {
            transform: scale(1) translateY(-10px);
            opacity: 1;
          }
        }

        .plant-loader .stage-1,
        .plant-loader .stage-2,
        .plant-loader .stage-3,
        .plant-loader .stage-4 {
          opacity: 0;
        }

        .plant-loader .stage-1 {
          animation: stage-1-fade ${animationDuration} ease-in-out infinite;
        }

        .plant-loader .stage-2 {
          animation: stage-2-fade ${animationDuration} ease-in-out infinite;
        }

        .plant-loader .stage-3 {
          animation: stage-3-fade ${animationDuration} ease-in-out infinite;
        }

        .plant-loader .stage-4 {
          animation: stage-4-fade ${animationDuration} ease-in-out infinite;
        }

        @keyframes stage-1-fade {
          0% {
            opacity: 1;
          }
          22% {
            opacity: 1;
          }
          25% {
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes stage-2-fade {
          0% {
            opacity: 0;
          }
          25% {
            opacity: 0;
          }
          28% {
            opacity: 1;
          }
          47% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes stage-3-fade {
          0% {
            opacity: 0;
          }
          50% {
            opacity: 0;
          }
          53% {
            opacity: 1;
          }
          72% {
            opacity: 1;
          }
          75% {
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes stage-4-fade {
          0% {
            opacity: 0;
          }
          75% {
            opacity: 0;
          }
          78% {
            opacity: 1;
          }
          100% {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

// Static plant icon for reduced motion preference
const StaticPlantIcon: React.FC<{ size: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size,
  className = ''
}) => {
  return (
    <div className={`${sizeMap[size]} ${className}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <linearGradient id="staticStemGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2D5A2B" />
            <stop offset="50%" stopColor="#3F7D3A" />
            <stop offset="100%" stopColor="#2D5A2B" />
          </linearGradient>
          <linearGradient id="staticLeafGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4A9045" />
            <stop offset="50%" stopColor="#3F7D3A" />
            <stop offset="100%" stopColor="#2D5A2B" />
          </linearGradient>
          <radialGradient id="staticPetalGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFD54F" />
            <stop offset="70%" stopColor="#F4C430" />
            <stop offset="100%" stopColor="#E0B020" />
          </radialGradient>
          <radialGradient id="staticCenterGradient" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#E8B84D" />
            <stop offset="50%" stopColor="#D4A520" />
            <stop offset="100%" stopColor="#B8860B" />
          </radialGradient>
        </defs>
        {/* Static full plant */}
        <line
          x1="50"
          y1="70"
          x2="50"
          y2="30"
          stroke="url(#staticStemGradient)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse
          cx="42"
          cy="50"
          rx="10"
          ry="6"
          fill="url(#staticLeafGradient)"
          transform="rotate(-20 42 50)"
        />
        <path
          d="M 42 50 L 36 50 M 42 50 L 38 48 M 42 50 L 38 52"
          stroke="#2D5A2B"
          strokeWidth="0.5"
          opacity="0.5"
        />
        <ellipse
          cx="58"
          cy="50"
          rx="10"
          ry="6"
          fill="url(#staticLeafGradient)"
          transform="rotate(20 58 50)"
        />
        <path
          d="M 58 50 L 64 50 M 58 50 L 62 48 M 58 50 L 62 52"
          stroke="#2D5A2B"
          strokeWidth="0.5"
          opacity="0.5"
        />
        {/* Flower petals */}
        <circle cx="50" cy="30" r="8" fill="url(#staticPetalGradient)" />
        <circle cx="42" cy="30" r="6" fill="url(#staticPetalGradient)" />
        <circle cx="58" cy="30" r="6" fill="url(#staticPetalGradient)" />
        <circle cx="50" cy="23" r="6" fill="url(#staticPetalGradient)" />
        <circle cx="50" cy="37" r="6" fill="url(#staticPetalGradient)" />
        {/* Flower center */}
        <circle cx="50" cy="30" r="4" fill="url(#staticCenterGradient)" />
        <circle cx="48" cy="29" r="0.5" fill="#E8B84D" opacity="0.8" />
        <circle cx="52" cy="29" r="0.5" fill="#E8B84D" opacity="0.8" />
        <circle cx="50" cy="31" r="0.5" fill="#B8860B" opacity="0.6" />
        {/* Soil line */}
        <line
          x1="30"
          y1="70"
          x2="70"
          y2="70"
          stroke="#6B3410"
          strokeWidth="3"
          opacity="0.4"
        />
        <line
          x1="30"
          y1="70"
          x2="70"
          y2="70"
          stroke="#8B4513"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
};
