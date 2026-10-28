import type { CSSProperties, ReactNode } from 'react';

// Outline set, 1.8 stroke, round caps (DESIGN "Icons"). Paths taken from the design canvas.

export type IconName = Name;

type Name =

  | 'add' | 'settings' | 'pause' | 'play' | 'chevron-down' | 'chevron-right' | 'back' | 'close' | 'external'
  | 'prev-sentence' | 'next-sentence' | 'auto-advance' | 'read-along' | 'link' | 'clipboard' | 'share'
  | 'cloud-off' | 'check' | 'arrow-up' | 'trash' | 'move-top' | 'mark-played' | 're-render' | 'retry' | 'drag'
  | 'minus' | 'plus' | 'shield' | 'warn' | 'download' | 'upload' | 'speaker' | 'more' | 'clock';

const P: Record<Name, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </g>
  ),
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  'prev-sentence': (
    <>
      <path d="M6 6v12" />
      <path d="M18 6l-9 6 9 6z" />
    </>
  ),
  'next-sentence': (
    <>
      <path d="M18 6v12" />
      <path d="M6 6l9 6-9 6z" />
    </>
  ),
  'auto-advance': (
    <>
      <path d="M4 6h12M4 11h12M4 16h7" />
      <path d="M15 14l5 3-5 3z" fill="currentColor" />
    </>
  ),
  'read-along': <path d="M4 6h16M4 10h16M4 14h11M4 18h7" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h4" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </>
  ),
  'cloud-off': (
    <>
      <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 11.6 3.3 3.3 0 0 0 7 18z" />
      <path d="M4 4l16 16" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  trash: <path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13" />,
  'move-top': <path d="M5 4h14M12 20V9M7 13l5-5 5 5" />,
  'mark-played': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.3l2.8 2.8L16.5 9.5" />
    </>
  ),
  're-render': (
    <>
      <path d="M5 9a7.5 7.5 0 0 1 13.4-2.4M19 15a7.5 7.5 0 0 1-13.4 2.4" />
      <path d="M18.5 3v4h-4M5.5 21v-4h4" />
    </>
  ),
  retry: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9" />
    </>
  ),
  drag: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </g>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="5.5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="18.5" r="1.8" />
    </g>
  ),
  minus: <path d="M6 12h12" />,

  plus: <path d="M6 12h12M12 6v12" />,
  shield: (
    <>
      <path d="M12 3l7 3v5.5c0 4.2-3 7.7-7 9.5-4-1.8-7-5.3-7-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  warn: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  upload: <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />,
  speaker: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />
    </>
  ),
};

export function Icon({ name, size = 22, stroke = 1.8, style, className }: { name: Name; size?: number; stroke?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={className}
    >
      {P[name]}
    </svg>
  );
}

/** Skip back/forward with the interval number inside the arrow. */
export function SkipIcon({ dir, seconds, size = 34, stroke = 1.5 }: { dir: 'back' | 'forward'; seconds: number; size?: number; stroke?: number }) {
  const back = dir === 'back';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? 'M4.6 9.2A8 8 0 1 1 4 13' : 'M19.4 9.2A8 8 0 1 0 20 13'} />
      <path d={back ? 'M4 4.5V9.5h5' : 'M20 4.5V9.5h-5'} />
      <text x={back ? 12.6 : 11.4} y="15.4" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="IBM Plex Sans, sans-serif" fontWeight="600">
        {seconds}
      </text>
    </svg>
  );
}

/** 16 dp state glyphs; each a distinct shape so states read in grayscale (DESIGN "Article states"). */
export function StatusGlyph({ kind, progress = 0 }: { kind: string; progress?: number }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true as const, className: 'glyph' };
  switch (kind) {
    case 'fetching':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="1 4.2">
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case 'rendering': {
      const circ = 2 * Math.PI * 8;
      return (
        <svg {...common} fill="none" strokeWidth="2.4">
          <circle cx="12" cy="12" r="8" stroke="currentColor" opacity="0.3" />
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeDasharray={`${Math.max(1, circ * progress)} ${circ}`} transform="rotate(-90 12 12)" strokeLinecap="round" />
        </svg>
      );
    }
    case 'queued':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'ready':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v7M9 12.5l3 3 3-3" />
        </svg>
      );
    case 'playing':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M5 18v-6M10 18V6M15 18v-9M20 18v-4" />
        </svg>
      );
    case 'partial':
      return (
        <svg {...common} fill="none" strokeWidth="2">
          <circle cx="12" cy="12" r="8" stroke="currentColor" />
          <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    case 'waiting':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 11.6 3.3 3.3 0 0 0 7 18z" />
          <path d="M4 4l16 16" />
        </svg>
      );
    case 'played':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    default:
      return null;
  }
}
