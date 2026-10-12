// Schemas for the GitHub REST payloads C2 consumes. GitHub owns these shapes
// and adds fields over time, so — unlike our own config/journal schemas —
// unknown keys are normal rather than typos, and a plain z.object strips what
// we do not name. Field names are the REST API's snake_case.
import { z } from 'zod'
import { nonBlankString } from '../../shared/schemaPrimitives.js'

const githubUserSchema = z.object({
  login: nonBlankString,
})

const githubLabelSchema = z.object({
  name: nonBlankString,
})

export const githubIssueSchema = z.object({
  number: z.number().int().positive(),
  title: nonBlankString,
  state: nonBlankString,
  labels: z.array(githubLabelSchema),
  user: githubUserSchema.nullable(),
  // Present only when an "issue" from /issues is actually a pull request; the
  // endpoint returns both, and a PR must never be treated as a triage trigger.
  pull_request: z.unknown().optional(),
})

export const githubCommentSchema = z.object({
  id: z.number().int(),
  body: z.string(),
  created_at: z.string(),
  user: githubUserSchema.nullable(),
})

// One REST timeline event. We consume only `labeled` events, but the array
// carries many event kinds, so every field beyond `event` is optional.
export const githubTimelineEventSchema = z.object({
  event: nonBlankString,
  actor: githubUserSchema.nullable().optional(),
  label: githubLabelSchema.nullable().optional(),
  created_at: z.string().optional(),
})

export type GithubIssue = z.infer<typeof githubIssueSchema>
export type GithubComment = z.infer<typeof githubCommentSchema>
export type GithubTimelineEvent = z.infer<typeof githubTimelineEventSchema>
