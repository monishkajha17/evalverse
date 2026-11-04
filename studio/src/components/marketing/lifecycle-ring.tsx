const STEPS = ["Trace", "Evaluate", "Review", "Improve"] as const;

export function LifecycleRing({ className = "" }: { className?: string }) {
  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[280px] ${className}`}>
      <svg viewBox="0 0 240 240" className="h-full w-full" role="img" aria-label="Lifecycle">
        <circle cx="120" cy="120" r="78" fill="none" stroke="#1B2A41" strokeWidth="1" />
        <g className="mk-ring-spin">
          <circle
            cx="120"
            cy="120"
            r="78"
            fill="none"
            stroke="url(#mkRingGrad)"
            strokeWidth="2"
            strokeDasharray="40 200"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="mkRingGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8EC5FF" />
              <stop offset="100%" stopColor="#2DD4BF" />
            </linearGradient>
          </defs>
        </g>
        {STEPS.map((label, i) => {
          const a = (-90 + i * 90) * (Math.PI / 180);
          const x = 120 + Math.cos(a) * 78;
          const y = 120 + Math.sin(a) * 78;
          return (
            <g key={label}>
              <circle cx={x} cy={y} r="5" fill="#050A14" stroke="#8EC5FF" strokeWidth="1.5" />
              <text
                x={120 + Math.cos(a) * 104}
                y={120 + Math.sin(a) * 104}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#8CA0BC"
                style={{ fontSize: 11, fontFamily: "var(--font-mono), monospace" }}
              >
                {label}
              </text>
            </g>
          );
        })}
        <text
          x="120"
          y="116"
          textAnchor="middle"
          fill="#E6F1FF"
          style={{ fontSize: 13, fontWeight: 300, letterSpacing: "-0.03em" }}
        >
          Lifecycle
        </text>
        <text
          x="120"
          y="134"
          textAnchor="middle"
          fill="#8CA0BC"
          style={{ fontSize: 10, fontFamily: "var(--font-mono), monospace" }}
        >
          continuous
        </text>
      </svg>
    </div>
  );
}
