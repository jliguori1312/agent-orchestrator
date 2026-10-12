// The user prompt handed to a read-only triage/plan session. The issue title
// and body are the task statement; both are untrusted input (SEC6), which is
// why the driver passes the prompt after a `--` separator so an issue body
// beginning with `-` cannot be parsed as a pi flag.
import type { GithubIssue } from '../github/githubSchemas.js'

export function composeIssuePrompt(issue: GithubIssue): string {
  // GitHub returns null for an issue opened without a description; an empty or
  // missing body is stated explicitly rather than left as a blank gap so the
  // session does not mistake it for a truncated prompt.
  const description = issue.body?.trim()
  const body = description === undefined || description === '' ? '(no description provided)' : description

  return `Issue #${issue.number}: ${issue.title}\n\n${body}`
}
