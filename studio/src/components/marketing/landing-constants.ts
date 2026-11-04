/** Release 0.1 figures for the marketing landing. Run date matches the cord export. */

export const GITHUB = "https://github.com/monishkajha17/evalverse";

export const RELEASE = "0.1";
export const RUN_DATE = "2026-11-04";

/** Findings bars — numbers from /data cord, audio, video suites (Release 0.1). */
export const FINDINGS = {
  runDate: RUN_DATE,
  sampleLine:
    "Release 0.1 was run on 30 real receipts (CORD v2), 12 spoken conversations (LibriSpeech) and 12 generated register videos.",
  items: [
    {
      id: "degraded",
      title: "Same accuracy, different failures",
      body: "Under blur, noise and low resolution Muse Spark 1.1 was right 57 of 90 times and 1.3 54 of 90; 1.1 was confidently wrong 17 times, 1.3 13 times and said it could not read it 23 times (1.1: 16).",
      bars: [
        { label: "1.1 correct", value: 57, max: 90 },
        { label: "1.3 correct", value: 54, max: 90 },
        { label: "1.1 confidently wrong", value: 17, max: 90 },
        { label: "1.3 confidently wrong", value: 13, max: 90 },
        { label: "1.1 could not read", value: 16, max: 90 },
        { label: "1.3 could not read", value: 23, max: 90 },
      ],
    },
    {
      id: "audio",
      title: "The transcript was fine, the reasoning was not",
      body: "On phone-quality audio Muse Spark 1.1 got 6 of 12 right; all 6 misses were reasoning errors and none were mis-heard.",
      bars: [
        { label: "Correct", value: 6, max: 12 },
        { label: "Reasoning miss", value: 6, max: 12 },
        { label: "Mis-heard", value: 0, max: 12 },
      ],
    },
    {
      id: "video-order",
      title: "A question that proved nothing",
      body: "Video event-order questions scored 6 of 12 with no frames at all, which is chance, so EvalVerse flags them.",
      bars: [
        { label: "Blind order correct", value: 6, max: 12 },
        { label: "Chance", value: 6, max: 12 },
      ],
    },
  ],
} as const;

/**
 * UMS for muse-spark-1.3 / clean / balanced from the cord suite score export
 * (scores block is not always mirrored into public/data/cord.json).
 * Dimensions with status unavailable are omitted; weights already re-balanced.
 */
export const CORD_UMS_CLEAN = {
  agent: "muse-spark-1.3",
  variant: "clean",
  profile: "balanced",
  ums: 0.8611,
  ci_95: [0.8056, 0.9075] as [number, number],
  gate: { pass: true, reasons: [] as string[] },
  weakest: { dimension: "Robustness", score: 0.5 },
  dimensions: [
    { name: "Perception", score: 1.0 },
    { name: "Groundedness", score: 0.8 },
    { name: "Honesty", score: 1.0 },
    { name: "Media dependence", score: 1.0 },
    { name: "Robustness", score: 0.5 },
  ],
  sourceNote: "cord suite · muse-spark-1.3 · clean · balanced",
};

/** Real cord case used in the evidence panel (right answer, wrong place). */
export const EVIDENCE_CASE = {
  caseId: "cord_total_05",
  agent: "muse-spark-1.3",
  variant: "clean",
  image: "/media/cord/cord_total_05.jpg",
  size: [720, 1280] as [number, number],
  truthBox: [505, 506, 750, 534] as [number, number, number, number],
  claimedBox: [632, 620, 708, 658] as [number, number, number, number],
  answer: "30.000",
  stageLabel: "Right answer, wrong place",
  stageKey: "correct_ungrounded",
  evaluator: {
    id: "evidence_grounding",
    status: "completed",
    score: 0.0,
    verdict: "fail",
    label: "ungrounded",
    explanation:
      "Cited region does not match the expected region (overlap 0.0, margin=25.0).",
  },
  source: "CORD v2 (CC BY 4.0)",
};

export const FRAMEWORK_DIMS = [
  {
    name: "Perception",
    def: "Did it read or hear the input correctly?",
    media: ["image", "video", "voice", "text"] as const,
  },
  {
    name: "Groundedness",
    def: "Is the answer backed by a specific place in the input?",
    media: ["image", "video", "voice", "text"] as const,
  },
  {
    name: "Temporal grounding",
    def: "Did it point to the right moment in the audio or video?",
    media: ["video", "voice"] as const,
  },
  {
    name: "Hallucination",
    def: "Did it say things that are not in the input?",
    media: ["image", "video", "voice", "text"] as const,
  },
  {
    name: "Completeness",
    def: "Did it leave out things it should have mentioned?",
    media: ["image", "video", "voice", "text"] as const,
  },
  {
    name: "Reasoning",
    def: "Given what it saw, did it reach the right conclusion?",
    media: ["image", "video", "voice", "text"] as const,
  },
] as const;

export const GLOSSARY: Record<string, string> = {
  trace: "The full record of one agent run, including every step and any media it used.",
  span: "One step inside a trace, such as a model call, a tool call, or a media transform.",
  evaluator: "A check that scores one thing about a run, often against the evidence in the input.",
  evidence: "The place in the input (region, time, or text) that should support the answer.",
  judge: "Another AI that grades answers a simple rule cannot check.",
  "offline evaluation": "Running a fixed set of examples against each version of your agent before you ship.",
  "online evaluation": "Checking traces from a running agent, usually under a sampling policy.",
  policy: "A rule that picks which live traces to check and which evaluators to run.",
  UMS: "Unified Multimodal Score: one number from 0 to 1 that combines the dimensions you choose.",
  "confidence interval": "A range that shows how much to trust a score given the sample size.",
  gate: "A pass or fail rule for a release, based on the score and its evidence.",
};

export type GlossaryKey = keyof typeof GLOSSARY;
