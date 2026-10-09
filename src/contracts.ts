// The data contracts (spec.md > Data Model). Field names are the contract.
// Schemas sent to the LLM must be strict-compatible: every field required, `nullable` instead of `optional`, no records.
import { z } from 'zod'

export const AgeBucket = z.enum(['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'])
export type AgeBucket = z.infer<typeof AgeBucket>
export const AGE_BUCKETS = AgeBucket.options

export const Channel = z.enum(['reel', 'preroll', 'tv', 'audio', 'billboard', 'social', 'email', 'general'])
export type Channel = z.infer<typeof Channel>

export const Gender = z.enum(['male', 'female'])

export const Brief = z.object({
  adText: z.string(),
  adType: z.enum(['copy', 'script']),
  channel: Channel,
  brandLine: z.string().nullable(),
  market: z.object({ country: z.string(), region: z.string().nullable(), city: z.string().nullable() }),
  target: z.object({
    text: z.string(),
    ageBuckets: z.array(AgeBucket).nullable(),
    gender: Gender.nullable(),
    interests: z.array(z.string()),
    communities: z.array(z.string()),
  }),
  unused: z.array(z.object({ phrase: z.string(), reason: z.string() })),
})
export type Brief = z.infer<typeof Brief>

export const QlooSignals = z.object({
  locationQuery: z.string().nullable(),
  locationId: z.string().nullable(),
  ageBuckets: z.array(AgeBucket).nullable(),
  gender: Gender.nullable(),
  audienceIds: z.array(z.string()),
  tagIds: z.array(z.string()),
  entityIds: z.array(z.string()),
})
export type QlooSignals = z.infer<typeof QlooSignals>

export const EvidenceItem = z.object({
  qlooId: z.string(),
  name: z.string(),
  type: z.string(),
  affinity: z.number().nullable(),
  imageUrl: z.string().nullable(),
})
export type EvidenceItem = z.infer<typeof EvidenceItem>

export const Segment = z.object({
  id: z.string(),
  name: z.string(),
  definedBy: z.array(z.string()),
  signals: QlooSignals,
  region: z.string().nullable().default(null), // "Austin, TX" (spec.md > D4b)
  ageBand: z.string().nullable().default(null), // "25-29"
  confidence: z.enum(['normal', 'broadened', 'thin']),
  confidenceNote: z.string().nullable(),
  fingerprint: z.array(EvidenceItem.extend({ distinctiveness: z.number() })),
  themes: z.array(EvidenceItem),
  setsApart: z.array(EvidenceItem),
})
export type Segment = z.infer<typeof Segment>

const Skew = z.object({
  age: z.record(AgeBucket, z.number()),
  gender: z.object({ male: z.number(), female: z.number() }),
})

export const Reference = z.object({
  text: z.string(),
  kind: z.enum(['entity', 'theme']),
  qlooId: z.string().nullable(),
  qlooType: z.string().nullable(),
  resolvedName: z.string().nullable(),
  fitBySegment: z.record(z.string(), z.number().nullable()),
  skew: Skew.nullable(),
})
export type Reference = z.infer<typeof Reference>

export const Arm = z.enum(['crowdcraft', 'b1_named', 'b2_invented', 'ablation'])
export type Arm = z.infer<typeof Arm>
export const ARMS = Arm.options

export const Verdict = z.enum(['love', 'like', 'meh', 'skip'])
export type Verdict = z.infer<typeof Verdict>

export const Highlight = z.object({
  quote: z.string(),
  start: z.number(),
  end: z.number(),
  effect: z.enum(['lands', 'loses']),
  reason: z.string(),
  sourceIds: z.array(z.string()),
})
export type Highlight = z.infer<typeof Highlight>

export const InventedPersona = z.object({
  bio: z.string(),
  favourites: z.array(z.object({ name: z.string(), type: z.string() })),
})
export type InventedPersona = z.infer<typeof InventedPersona>

export const Review = z.object({
  segmentId: z.string(),
  arm: Arm,
  verdict: Verdict,
  wouldAct: z.string(),
  reaction: z.array(z.object({ sentence: z.string(), sourceIds: z.array(z.string()) })),
  highlights: z.array(Highlight),
  judgement: z.number(),
  refFit: z.number().nullable(),
  rankingScore: z.number(),
  dropped: z.array(z.object({ kind: z.enum(['claim', 'highlight']), text: z.string(), reason: z.string() })),
  inventedPersona: InventedPersona.nullable(),
})
export type Review = z.infer<typeof Review>

// The "What to do" step (spec.md > Summary). Strict-compatible: it is also the LLM's output schema.
export const Summary = z.object({
  bottomLine: z.string(),
  actions: z.array(
    z.object({
      kind: z.enum(['keep', 'fix', 'try', 'spend', 'skip']),
      text: z.string(),
      segmentIds: z.array(z.string()),
      quote: z.string().nullable(),
    }),
  ),
})
export type Summary = z.infer<typeof Summary>

export const TraceEvent = z.object({
  t: z.number(),
  stage: z.enum(['brief', 'signals', 'candidates', 'fingerprints', 'select', 'references', 'fit', 'judge', 'report']),
  kind: z.enum(['qloo_call', 'llm_call', 'decision', 'warning', 'error']),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
})
export type TraceEvent = z.infer<typeof TraceEvent>

export const Usage = z.object({
  qlooCalls: z.number(),
  llmCalls: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.number(),
  ms: z.number(),
})
export type Usage = z.infer<typeof Usage>

export const Run = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  brief: Brief,
  segments: z.array(Segment),
  references: z.array(Reference),
  reviews: z.array(Review),
  verdictLine: z.string(),
  summary: Summary.nullable().default(null),
  trace: z.array(TraceEvent),
  usage: Usage,
  errors: z.array(z.object({ stage: z.string(), message: z.string() })),
})
export type Run = z.infer<typeof Run>

// Dev-only input for `run --fixture`: skips every Qloo stage.
export const Fixture = z.object({ brief: Brief, segments: z.array(Segment), references: z.array(Reference) })
export type Fixture = z.infer<typeof Fixture>

// Eval set (spec.md > Data Model > EvalAd). Segments are plain terms, resolved to Qloo when the Qloo arms run.
export const EvalSegmentSpec = z.object({
  id: z.string(),
  name: z.string(),
  locationQuery: z.string().nullable(),
  ageBuckets: z.array(AgeBucket).nullable(),
  gender: Gender.nullable(),
  tagQueries: z.array(z.string()),
  entityQueries: z.array(z.string()),
})
export type EvalSegmentSpec = z.infer<typeof EvalSegmentSpec>

export const EvalAd = z.object({
  id: z.string(),
  tier: z.enum(['A', 'B', 'C', 'D', 'demo']),
  briefText: z.string(),
  brief: Brief,
  segments: z.array(EvalSegmentSpec),
  intendedSegmentId: z.string().nullable(), // Tier D: the brief's target segment
  actualFitSegmentId: z.string().nullable(), // Tier D: the crowd the references really fit
})
export type EvalAd = z.infer<typeof EvalAd>
