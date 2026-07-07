export function PageContainer({ children, className = "" }) {
  return (
    <main className={`w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 ${className}`}>
      {children}
    </main>
  );
}
