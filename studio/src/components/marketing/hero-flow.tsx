/** Animated multimodal → agent → trace → evaluators → verdict diagram. */
export function HeroFlow() {
  return (
    <div className="mk-hero-flow mt-12 w-full" aria-hidden={false}>
      <svg
        viewBox="0 0 960 320"
        className="h-auto w-full"
        role="img"
        aria-label="Image, video, text and voice converge into your agent, then a trace, evaluators, and a verdict"
      >
        <defs>
          <linearGradient id="mkFlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8EC5FF" />
            <stop offset="100%" stopColor="#2DD4BF" />
          </linearGradient>
          <marker id="mkArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#8CA0BC" />
          </marker>
        </defs>

        {/* Input cards */}
        {[
          { y: 18, label: "Image", sub: "receipt photo", glyph: "receipt" },
          { y: 92, label: "Video", sub: "screen clip", glyph: "film" },
          { y: 166, label: "Text", sub: "typed question", glyph: "text" },
          { y: 240, label: "Voice", sub: "spoken request", glyph: "wave" },
        ].map((card, i) => {
          const cy = card.y + 28;
          return (
            <g key={card.label}>
              <rect
                x="8"
                y={card.y}
                width="148"
                height="56"
                rx="10"
                fill="#0A1220"
                stroke="#1B2A41"
              />
              <g transform={`translate(20 ${card.y + 12})`} fill="none" stroke="#8EC5FF" strokeWidth="1.4">
                {card.glyph === "receipt" ? (
                  <>
                    <rect x="0" y="0" width="22" height="30" rx="2" />
                    <path d="M5 8 H17 M5 14 H17 M5 20 H13" />
                  </>
                ) : null}
                {card.glyph === "film" ? (
                  <>
                    <rect x="0" y="2" width="28" height="24" rx="2" />
                    <path d="M0 8 H28 M0 20 H28 M6 2 V26 M22 2 V26" />
                  </>
                ) : null}
                {card.glyph === "text" ? (
                  <>
                    <path d="M2 6 H24 L20 22 H6 Z" />
                    <path d="M8 12 H18 M8 16 H14" />
                  </>
                ) : null}
                {card.glyph === "wave" ? (
                  <path d="M2 16 Q6 4 10 16 T18 16 T26 16" />
                ) : null}
              </g>
              <text x="52" y={card.y + 24} fill="#E6F1FF" style={{ fontSize: 12, fontWeight: 500 }}>
                {card.label}
              </text>
              <text x="52" y={card.y + 40} fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
                {card.sub}
              </text>
              <path
                className="mk-flow-path"
                d={`M 156 ${cy} C 210 ${cy}, 210 160, 250 160`}
                fill="none"
                stroke="url(#mkFlowGrad)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              <circle className="mk-flow-pulse" style={{ animationDelay: `${i * 0.35}s` }} r="3.5" fill="#8EC5FF">
                <animateMotion
                  dur="6s"
                  repeatCount="indefinite"
                  begin={`${i * 0.35}s`}
                  path={`M 156 ${cy} C 210 ${cy}, 210 160, 250 160`}
                />
              </circle>
            </g>
          );
        })}

        {/* Agent */}
        <rect x="250" y="128" width="168" height="64" rx="10" fill="#0A1220" stroke="#8EC5FF" />
        <text x="334" y="154" textAnchor="middle" fill="#E6F1FF" style={{ fontSize: 12, fontWeight: 500 }}>
          Your agent
        </text>
        <text x="334" y="172" textAnchor="middle" fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
          (any model)
        </text>

        <path
          className="mk-flow-path"
          d="M 418 160 H 470"
          fill="none"
          stroke="#8CA0BC"
          strokeWidth="1.5"
          markerEnd="url(#mkArrow)"
        />
        <circle className="mk-flow-pulse" r="3.5" fill="#2DD4BF">
          <animateMotion dur="6s" repeatCount="indefinite" begin="1.2s" path="M 418 160 H 470" />
        </circle>

        {/* Trace */}
        <rect x="470" y="128" width="168" height="64" rx="10" fill="#0A1220" stroke="#1B2A41" />
        <text x="554" y="154" textAnchor="middle" fill="#E6F1FF" style={{ fontSize: 12, fontWeight: 500 }}>
          Trace: every step kept
        </text>
        <text x="554" y="172" textAnchor="middle" fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
          media · spans · joins
        </text>

        <path
          className="mk-flow-path"
          d="M 638 160 H 690"
          fill="none"
          stroke="#8CA0BC"
          strokeWidth="1.5"
          markerEnd="url(#mkArrow)"
        />
        <circle className="mk-flow-pulse" r="3.5" fill="#8EC5FF">
          <animateMotion dur="6s" repeatCount="indefinite" begin="2s" path="M 638 160 H 690" />
        </circle>

        {/* Evaluators */}
        <rect x="690" y="128" width="200" height="64" rx="10" fill="#0A1220" stroke="#1B2A41" />
        <text x="790" y="154" textAnchor="middle" fill="#E6F1FF" style={{ fontSize: 12, fontWeight: 500 }}>
          Evaluators: checks and a judge
        </text>
        <text x="790" y="172" textAnchor="middle" fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
          rules · evidence · grade
        </text>

        <path
          className="mk-flow-path"
          d="M 790 192 V 230"
          fill="none"
          stroke="#F43F5E"
          strokeWidth="1.5"
          markerEnd="url(#mkArrow)"
        />
        <circle className="mk-flow-pulse" r="3.5" fill="#F43F5E">
          <animateMotion dur="6s" repeatCount="indefinite" begin="2.8s" path="M 790 192 V 230" />
        </circle>

        {/* Verdict */}
        <rect x="690" y="230" width="200" height="48" rx="10" fill="rgba(244,63,94,0.08)" stroke="#F43F5E" />
        <text x="790" y="258" textAnchor="middle" fill="#F43F5E" style={{ fontSize: 12, fontWeight: 500 }}>
          Verdict: where it went wrong
        </text>
      </svg>
    </div>
  );
}
