import { AlertTriangle } from 'lucide-react';

export function MediaWarningsBanner({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        {warnings.map((warning, idx) => (
          <div key={`${warning}-${idx}`}>{warning}</div>
        ))}
      </div>
    </div>
  );
}
