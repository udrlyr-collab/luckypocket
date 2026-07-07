import { BaseCard } from "./BaseCard";

export function LoadingCard({ className = "" }) {
  return (
    <BaseCard className={`animate-pulse ${className}`}>
      <div className="h-4 bg-base-300 rounded w-1/4 mb-4"></div>
      <div className="h-8 bg-base-300 rounded w-1/2 mb-4"></div>
      <div className="h-4 bg-base-300 rounded w-3/4"></div>
    </BaseCard>
  );
}
