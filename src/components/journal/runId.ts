// Run identity (ADR-0005 §1). The id embeds in worktree names
// (`agent-<issue>-<run_id>`) and HTML comment markers
// (`<!-- agent:run=<run_id> -->`, plan §6), so its charset is a safety
// property, and its lexicographic order must equal chronological order so a
// human correlates runs by eye, without parsing anything.
import { randomBytes } from 'node:crypto'

// One run id's charset: timestamp + hex suffix. Exported as a source fragment
// so the comment-marker regex (registry/runMarker.ts) embeds exactly the same
// shape instead of restating it — the two must never drift.
export const RUN_ID_BODY_SOURCE = '\\d{6}T\\d{6}Z-[0-9a-f]{4}'

export const RUN_ID_PATTERN = new RegExp(`^${RUN_ID_BODY_SOURCE}$`)

export function generateRunId(now: () => Date = () => new Date()): string {
  // All fields read in UTC — a run started at a host's local midnight and one
  // started at UTC midnight must still sort by real time.
  const moment = now()
  const timestamp = [
    padTwo(moment.getUTCFullYear() % 100),
    padTwo(moment.getUTCMonth() + 1),
    padTwo(moment.getUTCDate()),
  ].join('')
  const timeOfDay = [
    padTwo(moment.getUTCHours()),
    padTwo(moment.getUTCMinutes()),
    padTwo(moment.getUTCSeconds()),
  ].join('')

  // 16 bits of randomness separate starts within the same second. The
  // scheduler is single-slot (ADR-0002 D2), so concurrent same-second starts
  // are impossible; a restart landing in the same second is the only case,
  // and the journal makes it visible.
  const randomSuffix = randomBytes(2).toString('hex')

  return `${timestamp}T${timeOfDay}Z-${randomSuffix}`
}

// Two-digit zero padding — the id's sortability depends on fixed-width
// fields, so '3' must never appear where '03' belongs.
function padTwo(value: number): string {
  return value.toString().padStart(2, '0')
}
