import { runSnackAction, useUi } from '../app/ui';

/** The one snackbar, above the mini player or action bar. */
export function Snackbar() {
  const { snack } = useUi();
  if (!snack) return null;
  return (
    <div className="snackbar" role="status" key={snack.id}>
      <p>{snack.text}</p>
      {snack.actions?.map((a) => (
        <button key={a.label} onClick={() => void runSnackAction(a)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
