import { Icon } from './Icon';

/**
 * Love toggle: a filled `accent` heart when loved, an outline `muted` one when not. The shape changes
 * as well as the color (DESIGN "Icons"), and the label names the article and says what the tap will do,
 * so there's no `aria-pressed` on top of it.
 */
export function LoveButton({ loved, title, onToggle, className = '' }: { loved: boolean; title: string; onToggle: () => void; className?: string }) {
  return (
    <button className={`icon-btn love-btn${loved ? ' on' : ''} ${className}`.trim()} aria-label={loved ? `Remove “${title}” from loved` : `Love “${title}”`} onClick={onToggle}>
      <Icon name={loved ? 'heart-filled' : 'heart'} />
    </button>
  );
}
