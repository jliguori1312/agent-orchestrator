// Shared fixtures and helpers for the journal tests, mirroring the config
// tests' approach: one minimal valid record, mutated one field at a time so
// each test states only the thing it cares about.
import type { ZodError } from 'zod'

// A complete journal record — every optional field present — matching the
// shapes ADR-0005 pins down.
export const validJournalRecord = {
  ts: '2026-10-11T09:03:12.482Z',
  run_id: '261011T090312Z-a3f2',
  event: 'run.claimed',
  issue: 42,
  data: { label: 'agent-in-progress' },
}

// The smallest record the schema accepts: no optional fields.
export const minimalJournalRecord = {
  ts: '2026-10-11T09:03:12.482Z',
  run_id: '261011T090312Z-a3f2',
  event: 'run.claimed',
}

// Every required field of a journal record. The missing-field test walks
// this list so adding a required field without updating the test is caught
// at the fixture definition.
export const requiredJournalRecordPaths = ['ts', 'run_id', 'event']

// Overlay `overrides` onto a clone of `record`. Untyped on purpose: schema
// tests must be able to feed *wrong-typed* values to the schema, which the
// fixture's inferred literal types would refuse at compile time.
export function withFields(record: object, overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...record, ...overrides }
}

// Clone `record` minus one field — the inverse of withFields for the
// missing-field walk.
export function withoutField(record: object, field: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...record }
  delete clone[field]
  return clone
}

// Zod issue paths flattened to dot notation — the same helper the config
// tests use, so both suites assert on identically-shaped paths.
export function issuePaths(zodError: ZodError): string[] {
  return zodError.issues.map((issue) => issue.path.map(String).join('.'))
}
