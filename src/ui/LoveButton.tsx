import { Icon } from './Icon';

/**
 * Love toggle: a filled `accent` heart when loved, an outline `muted` one when not. The shape changes
 * as well as the color (DESIGN "Icons"), and the label says what the tap will do, so there's no `aria-pressed` on top of it.
 */
export function LoveButton({ loved, onToggle, className = '' }: { loved: boolean; onToggle: () => void; className?: string }) {
  return (
    <button className={`icon-btn love-btn${loved ? ' on' : ''} ${className}`.trim()} aria-label={loved ? 'Remove from loved' : 'Love this article'} onClick={onToggle}>
      <Icon name={loved ? 'heart-filled' : 'heart'} />
    </button>
  );
}
