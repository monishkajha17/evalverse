/** Hand-built receipt SVG: teal truth box vs crimson agent look box. */
export function ReceiptHeroSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 360"
      className={className}
      role="img"
      aria-labelledby="receipt-hero-title receipt-hero-desc"
    >
      <title id="receipt-hero-title">Receipt evidence mismatch</title>
      <desc id="receipt-hero-desc">
        A receipt with a teal box where the answer is and a dashed crimson box where the agent looked,
        connected by a line.
      </desc>
      <defs>
        <filter id="soft" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#101B2D" floodOpacity="0.08" />
        </filter>
      </defs>
      <rect x="48" y="28" width="260" height="304" rx="10" fill="#fff" stroke="#D7DDE7" filter="url(#soft)" />
      <rect x="68" y="48" width="220" height="12" rx="2" fill="#EEF1F5" />
      <rect x="88" y="68" width="180" height="6" rx="2" fill="#EEF1F5" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <rect x="72" y={100 + i * 22} width={120 - i * 6} height="8" rx="2" fill="#EEF1F5" />
          <rect x="220" y={100 + i * 22} width="56" height="8" rx="2" fill="#EEF1F5" />
        </g>
      ))}
      <rect x="72" y="248" width="90" height="10" rx="2" fill="#D7DDE7" />
      <rect x="220" y="246" width="56" height="12" rx="2" fill="#101B2D" opacity="0.85" />
      {/* Truth: total line */}
      <rect
        x="200"
        y="238"
        width="96"
        height="28"
        rx="4"
        fill="rgba(11,143,122,0.12)"
        stroke="#0B8F7A"
        strokeWidth="2"
      />
      <text x="208" y="256" fill="#0B8F7A" style={{ fontSize: 9, fontWeight: 600 }}>
        where the answer is
      </text>
      {/* Agent look: wrong region */}
      <rect
        x="64"
        y="118"
        width="140"
        height="48"
        rx="4"
        fill="rgba(212,40,92,0.06)"
        stroke="#D4285C"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <text x="72" y="146" fill="#D4285C" style={{ fontSize: 9, fontWeight: 600 }}>
        where the agent looked
      </text>
      {/* Connector */}
      <path
        d="M 204 142 C 260 142, 280 200, 248 238"
        fill="none"
        stroke="#D4285C"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        opacity="0.7"
      />
      <circle cx="204" cy="142" r="3" fill="#D4285C" />
      <circle cx="248" cy="238" r="3" fill="#0B8F7A" />
      {/* Side callouts */}
      <g transform="translate(320, 120)">
        <rect width="88" height="44" rx="6" fill="#fff" stroke="#D7DDE7" />
        <text x="10" y="18" fill="#6A7B93" style={{ fontSize: 9 }}>
          Agent said
        </text>
        <text x="10" y="34" fill="#D4285C" style={{ fontSize: 11, fontWeight: 700 }}>
          42.50
        </text>
      </g>
      <g transform="translate(320, 230)">
        <rect width="88" height="44" rx="6" fill="#fff" stroke="#D7DDE7" />
        <text x="10" y="18" fill="#6A7B93" style={{ fontSize: 9 }}>
          Truth
        </text>
        <text x="10" y="34" fill="#0B8F7A" style={{ fontSize: 11, fontWeight: 700 }}>
          128.00
        </text>
      </g>
    </svg>
  );
}
