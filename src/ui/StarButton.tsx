import { Icon } from './Icon';

/**
 * Star toggle: a filled `accent` star when starred, an outline `muted` one when not. The shape changes
 * as well as the color (DESIGN "Icons"), and `aria-pressed` carries it for a screen reader.
 */
export function StarButton({ starred, title, onToggle, className = '' }: { starred: boolean; title: string; onToggle: () => void; className?: string }) {
  return (
    <button className={`icon-btn star-btn${starred ? ' on' : ''} ${className}`.trim()} aria-pressed={starred} aria-label={`Star ${title}`} onClick={onToggle}>
      <Icon name={starred ? 'star-filled' : 'star'} />
    </button>
  );
}
