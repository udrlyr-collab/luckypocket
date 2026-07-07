export function SectionHeader({ title, eyebrow, rightContent, className = "" }) {
  return (
    <div className={`mb-6 flex items-end justify-between ${className}`}>
      <div>
        {eyebrow && <p className="text-xs font-black tracking-widest text-primary uppercase mb-1">{eyebrow}</p>}
        <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
      </div>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
}
