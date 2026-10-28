import { Icon } from '../ui/Icon';

/**
 * Blocks the app until it has a working invite (SPEC §10a): opened without `#invite=`, or the
 * Worker rejected the secret (it was changed to cut off old links). Opening an invite link clears it.
 */
export function InviteNeeded({ rejected }: { rejected: boolean }) {
  return (
    <div className="app">
      <div className="empty invite-needed" role="alert">
        <div className="empty-icon">
          <Icon name="link" size={36} />
        </div>
        <h2>{rejected ? 'Your invite doesn’t work anymore' : 'Reader needs an invite'}</h2>
        <p>
          {rejected
            ? 'Ask the person who shared Reader with you for a new invite link, then open it on this device.'
            : 'Reader is invite-only. Ask the person who shared it with you for their invite link, then open it on this device.'}
        </p>
      </div>
    </div>
  );
}
