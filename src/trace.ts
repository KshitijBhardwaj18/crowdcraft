// One Trace per run: the event log the report and M2's UI read, plus usage counters.
import type { TraceEvent, Usage } from './contracts.ts'

export class Trace {
  readonly events: TraceEvent[] = []
  readonly usage: Usage = { qlooCalls: 0, llmCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, ms: 0 }
  private readonly t0 = Date.now()
  log?: (e: TraceEvent) => void

  add(stage: TraceEvent['stage'], kind: TraceEvent['kind'], message: string, detail: TraceEvent['detail'] = null) {
    const e = { t: Date.now() - this.t0, stage, kind, message, detail }
    this.events.push(e)
    this.log?.(e)
  }

  finish() {
    this.usage.ms = Date.now() - this.t0
    return this
  }
}

// Concurrency cap plus a minimum gap between starts (a crude per-minute rate limit).
export function limiter(concurrency: number, minGapMs = 0) {
  let active = 0
  let lastStart = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= concurrency || !queue.length) return
    const wait = Math.max(0, lastStart + minGapMs - Date.now())
    if (wait) return void setTimeout(next, wait)
    active++
    lastStart = Date.now()
    queue.shift()!()
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          }),
      )
      next()
    })
}

// Unbiased Fisher–Yates shuffle (a copy).
export function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
