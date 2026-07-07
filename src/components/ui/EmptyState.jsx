export function EmptyState({ message, icon = "📭", className = "" }) {
  return (
    <div className={`py-12 flex flex-col items-center justify-center text-center ${className}`}>
      <span className="text-4xl mb-3 opacity-50">{icon}</span>
      <p className="text-sm font-bold text-base-content/50">{message}</p>
    </div>
  );
}
