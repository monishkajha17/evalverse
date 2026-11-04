export function BrowserFrame({
  children,
  url = "studio.evalverse.local",
  className = "",
}: {
  children: React.ReactNode;
  url?: string;
  className?: string;
}) {
  return (
    <div className={`mk-browser ${className}`}>
      <div className="mk-browser-bar">
        <span className="mk-browser-dot" />
        <span className="mk-browser-dot" />
        <span className="mk-browser-dot" />
        <span className="mk-mono ml-3 truncate text-[10px] text-[var(--mk-muted)]">{url}</span>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
