// Tests for the triage/plan user prompt. The issue title and body are the task
// statement; a null or blank body must be stated explicitly rather than left as
// a silent gap the session could misread as a truncated prompt.
import { describe, expect, it } from 'vitest'
import { composeIssuePrompt } from '../../../src/components/tick/issuePrompt.js'
import { issue } from '../registry/fixtures.js'

describe('composeIssuePrompt', () => {
  it('includes the issue number, title, and body', () => {
    const prompt = composeIssuePrompt({
      ...issue(42, []),
      title: 'Fix the widget',
      body: 'It wobbles when spun.',
    })

    expect(prompt).toContain('Issue #42: Fix the widget')
    expect(prompt).toContain('It wobbles when spun.')
  })

  it('states the absence of a body explicitly', () => {
    const prompt = composeIssuePrompt({ ...issue(42, []), body: null })

    expect(prompt).toContain('Issue #42')
    expect(prompt).toContain('(no description provided)')
  })

  it('treats a whitespace-only body as absent', () => {
    const prompt = composeIssuePrompt({ ...issue(42, []), body: '   \n' })

    expect(prompt).toContain('(no description provided)')
  })
})
