// Specificity grading (prd.md > Eval Command and Scorecard): Claude counts specific vs generic claims per reaction,
// without knowing which arm wrote it. Batched, shuffled, unlabelled.
import { z } from 'zod'
import type { Review } from '../contracts.ts'
import { gradeWithClaude } from '../llm.ts'

export type Grade = { specific: number; generic: number }

const SYSTEM = `You grade audience reactions to ads for specificity. You return only the requested JSON.

For each reaction, split it into claims (usually one per sentence) and count:
- specific: the claim names a concrete, real-world cultural item tied to this crowd's own taste (an artist, song, brand, venue, place, show, podcast, game, food or event), or a precise taste detail about them. Restating something the ad already says only counts as specific if the reaction connects it to something else the crowd loves.
- generic: the claim could be said about almost any audience ("we value authenticity", "the visuals are great", "this feels relatable", "I'd share it").
Every claim is exactly one of the two.`

const Out = z.object({ items: z.array(z.object({ id: z.string(), specific: z.number(), generic: z.number() })) })

export async function gradeSpecificity(
  items: { key: string; adText: string; review: Review }[],
  batchSize = 12,
): Promise<Map<string, Grade>> {
  const grades = new Map<string, Grade>()
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  const batches: (typeof items)[] = []
  for (let i = 0; i < shuffled.length; i += batchSize) batches.push(shuffled.slice(i, i + batchSize))
  await Promise.all(
    batches.map(async (batch) => {
      const ids = new Map(batch.map((it, i) => [`r${i + 1}`, it.key]))
      const prompt = batch
        .map(
          (it, i) =>
            `### r${i + 1}\nThe ad:\n"""\n${it.adText}\n"""\nReaction:\n${it.review.reaction.map((s) => `- ${s.sentence}`).join('\n') || '(empty)'}`,
        )
        .join('\n\n')
      const out = await gradeWithClaude(Out, SYSTEM, `Grade each reaction below. Return one item per reaction id.\n\n${prompt}`)
      for (const g of out.items) {
        const key = ids.get(g.id)
        if (key) grades.set(key, { specific: Math.max(0, Math.round(g.specific)), generic: Math.max(0, Math.round(g.generic)) })
      }
    }),
  )
  return grades
}
