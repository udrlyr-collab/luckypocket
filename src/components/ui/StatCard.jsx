export function StatCard({ label, value, description, icon, className = "", valueClassName = "" }) {
  return (
    <div className={`rounded-2xl bg-base-100 p-4 shadow-sm border border-base-200 ${className}`}>
      <span className="text-[11px] font-bold text-base-content/50 flex items-center gap-1">
        {icon && <span>{icon}</span>}
        {label}
      </span>
      <strong className={`mt-1 block truncate text-base font-black tabular-nums ${valueClassName}`}>
        {value}
      </strong>
      {description && (
        <span className="text-[10px] font-bold text-base-content/40 block mt-0.5">
          {description}
        </span>
      )}
    </div>
  );
}
