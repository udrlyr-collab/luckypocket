export function BaseCard({ children, variant = "default", className = "", ...props }) {
  let variantClass = "border-base-300 bg-base-100";
  if (variant === "highlight") {
    variantClass = "border-primary/20 bg-primary/5";
  } else if (variant === "warning") {
    variantClass = "border-warning/30 bg-warning/10";
  } else if (variant === "error") {
    variantClass = "border-error/30 bg-error/10";
  } else if (variant === "success") {
    variantClass = "border-success/30 bg-success/10";
  }

  return (
    <div
      className={`rounded-3xl border shadow-sm p-5 sm:p-6 min-w-0 ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
