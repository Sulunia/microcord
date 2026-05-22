/**
 * Win7-style spinner from 7.css with "Loading" text.
 * Uses the native .spinner.animate class from 7.css.
 */
export function LoadingSpinner({ text = 'Loading' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flex: 1, minHeight: 80 }}>
      <span class="spinner animate" />
      <span style={{ fontSize: '0.8rem', color: 'var(--mc-text-muted)' }}>{text}</span>
    </div>
  );
}
