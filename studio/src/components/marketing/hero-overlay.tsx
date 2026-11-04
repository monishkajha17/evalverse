/** Low-opacity animated receipt evidence overlay for the hero. */
export function HeroOverlay() {
  return (
    <div className="mk-hero-overlay" aria-hidden>
      <svg viewBox="0 0 520 420" className="h-[min(70vh,560px)] w-full max-w-3xl">
        <defs>
          <filter id="mk-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>
        <g filter="url(#mk-blur)" opacity="0.95">
          <rect x="130" y="40" width="260" height="340" rx="14" fill="#0A1220" stroke="#1B2A41" strokeWidth="2" />
          <rect x="152" y="64" width="216" height="10" rx="2" fill="#1B2A41" />
          <rect x="168" y="86" width="184" height="6" rx="2" fill="#1B2A41" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <g key={i}>
              <rect x="156" y={120 + i * 24} width={130 - i * 4} height="8" rx="2" fill="#1B2A41" />
              <rect x="310" y={120 + i * 24} width="52" height="8" rx="2" fill="#1B2A41" />
            </g>
          ))}
          <rect x="156" y="310" width="88" height="10" rx="2" fill="#24344D" />
          <rect x="308" y="306" width="56" height="14" rx="2" fill="#E6F1FF" opacity="0.55" />

          {/* Truth */}
          <rect
            x="288"
            y="296"
            width="100"
            height="34"
            rx="6"
            fill="rgba(45,212,191,0.12)"
            stroke="#2DD4BF"
            strokeWidth="2"
          />
          <text x="298" y="317" fill="#2DD4BF" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
            where the answer is
          </text>

          {/* Claimed — drifts */}
          <g className="mk-hero-claimed">
            <rect
              x="148"
              y="140"
              width="150"
              height="52"
              rx="6"
              fill="rgba(244,63,94,0.08)"
              stroke="#F43F5E"
              strokeWidth="2"
              strokeDasharray="6 5"
            />
            <text x="158" y="170" fill="#F43F5E" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
              where the agent looked
            </text>
            <path
              d="M 298 166 C 340 166, 360 240, 338 296"
              fill="none"
              stroke="#F43F5E"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            <circle cx="298" cy="166" r="3" fill="#F43F5E" />
            <circle cx="338" cy="296" r="3" fill="#2DD4BF" />
          </g>
        </g>
      </svg>
    </div>
  );
}
