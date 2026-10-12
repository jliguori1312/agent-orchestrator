// The `gh`-driven GitHub adapter (C2, part 2). Every call is authenticated with
// a GitHub App installation token passed per-invocation as GH_TOKEN — never an
// ambient user token (ADR-0003). A call GitHub rejects as unauthorized (401 or
// 403) refreshes the token once and retries, because an installation token can
// expire mid-tick.
import { z, type ZodType } from 'zod'
import { GitHubError } from './githubError.js'
import {
  firstLine,
  ghExec,
  ghJson,
  httpStatusFromStderr,
  runGh,
  type GhResult,
  type GhSpawn,
} from './ghRunner.js'
import {
  githubCommentSchema,
  githubContentsSchema,
  githubIssueSchema,
  githubTimelineEventSchema,
  type GithubComment,
  type GithubIssue,
} from './githubSchemas.js'
import { latestLabelActor } from './trustedActor.js'

// GitHub caps list responses; 100 is the API maximum and is far more than M1
// ever needs. A repo with more ready issues or more comments on one issue than
// this would need pagination, which is deferred until a real need appears.
const PAGE_SIZE = 100

export interface GitHubClientDeps {
  // "owner/name", exactly as hostConfig.target.repo carries it.
  readonly repo: string
  // Mints or re-mints a fresh installation token (wired to obtainInstallationToken).
  readonly obtainToken: () => Promise<string>
  readonly spawn?: GhSpawn
}

export interface LabelChange {
  readonly add: readonly string[]
  readonly remove: readonly string[]
}

export interface GitHubClient {
  getIssue(issueNumber: number): Promise<GithubIssue>
  listIssuesByLabel(label: string): Promise<GithubIssue[]>
  listComments(issueNumber: number): Promise<GithubComment[]>
  postComment(issueNumber: number, body: string): Promise<void>
  setLabels(issueNumber: number, change: LabelChange): Promise<void>
  lastLabelActor(issueNumber: number, labelName: string): Promise<string | null>
  isCollaborator(login: string): Promise<boolean>
  // The raw text of one repo file (e.g. the target repo's .github/agent.yml
  // policy). A missing file is a GitHubError with httpStatus 404, so callers
  // can distinguish "no policy" from "policy unreadable".
  getRepoFile(path: string): Promise<string>
}

export function createGitHubClient(deps: GitHubClientDeps): GitHubClient {
  const { owner, name } = splitRepo(deps.repo)
  const issuesPath = `repos/${owner}/${name}/issues`

  // The token is obtained lazily and reused for the tick; on an auth failure it
  // is discarded and re-obtained once. The scheduler is single-slot and every
  // tick is a fresh process, so nothing survives between runs.
  let cachedToken: string | undefined

  async function installationToken(): Promise<string> {
    cachedToken ??= await deps.obtainToken()
    return cachedToken
  }

  // Runs one gh invocation, retrying exactly once with a fresh token when
  // GitHub answers 401/403. Any other failure propagates untouched.
  async function dispatch<T>(invocation: (token: string) => Promise<T>): Promise<T> {
    try {
      return await invocation(await installationToken())
    } catch (failure) {
      if (!isAuthFailure(failure)) throw failure
      cachedToken = undefined
      return invocation(await installationToken())
    }
  }

  function json<T>(args: readonly string[], schema: ZodType<T>): Promise<T> {
    return dispatch((token) => ghJson({ args, token, schema, spawn: deps.spawn }))
  }

  function execute(args: readonly string[]): Promise<void> {
    return dispatch((token) => ghExec({ args, token, spawn: deps.spawn }))
  }

  // A raw call returns the exit code instead of throwing, which isCollaborator
  // needs (404 is a legitimate "no"). Auth failures are still raised so the
  // dispatch retry fires.
  function raw(args: readonly string[]): Promise<GhResult> {
    return dispatch(async (token) => {
      const result = await runGh({ args, token, spawn: deps.spawn })
      const httpStatus = httpStatusFromStderr(result.stderr)
      if (result.exitCode !== 0 && isAuthStatus(httpStatus)) {
        throw new GitHubError(`gh ${args.join(' ')} failed: ${firstLine(result.stderr)}`, httpStatus)
      }
      return result
    })
  }

  return {
    getIssue(issueNumber) {
      return json(['api', `${issuesPath}/${issueNumber}`], githubIssueSchema)
    },

    async listIssuesByLabel(label) {
      const args = [
        'api',
        `${issuesPath}?labels=${encodeURIComponent(label)}&state=open&per_page=${PAGE_SIZE}`,
      ]
      const issues = await json(args, z.array(githubIssueSchema))
      return issues.filter((issue) => issue.pull_request === undefined)
    },

    listComments(issueNumber) {
      return json(
        ['api', `${issuesPath}/${issueNumber}/comments?per_page=${PAGE_SIZE}`],
        z.array(githubCommentSchema),
      )
    },

    postComment(issueNumber, body) {
      return execute(['issue', 'comment', String(issueNumber), '--repo', deps.repo, '--body', body])
    },

    async setLabels(issueNumber, change) {
      if (change.add.length === 0 && change.remove.length === 0) return

      const args = ['issue', 'edit', String(issueNumber), '--repo', deps.repo]
      for (const label of change.add) args.push('--add-label', label)
      for (const label of change.remove) args.push('--remove-label', label)
      await execute(args)
    },

    async lastLabelActor(issueNumber, labelName) {
      const events = await json(
        ['api', `${issuesPath}/${issueNumber}/timeline?per_page=${PAGE_SIZE}`],
        z.array(githubTimelineEventSchema),
      )
      return latestLabelActor(events, labelName)
    },

    async isCollaborator(login) {
      const result = await raw(['api', `repos/${owner}/${name}/collaborators/${login}`])
      if (result.exitCode === 0) return true

      const httpStatus = httpStatusFromStderr(result.stderr)
      // GitHub answers 404 for a non-collaborator; any other failure is a real
      // error and must not read as "not a collaborator".
      if (httpStatus === 404) return false
      throw new GitHubError(
        `Cannot check collaborator ${login} on ${deps.repo}: ${firstLine(result.stderr)}`,
        httpStatus,
      )
    },

    async getRepoFile(path) {
      const contentsPath = `repos/${owner}/${name}/contents/${path}`
      const contents = await json(['api', contentsPath], githubContentsSchema)

      // The contents API can answer with a different encoding for large files;
      // decoding that as base64 would produce mojibake, so it is refused.
      if (contents.encoding !== 'base64') {
        throw new GitHubError(
          `${contentsPath} returned unexpected encoding "${contents.encoding}"`,
        )
      }

      // GitHub wraps the base64 body at 60 characters; Buffer ignores the
      // newlines, so no manual unwrapping is needed.
      return Buffer.from(contents.content, 'base64').toString('utf8')
    },
  }
}

function isAuthStatus(httpStatus: number | undefined): boolean {
  return httpStatus === 401 || httpStatus === 403
}

function isAuthFailure(failure: unknown): boolean {
  return failure instanceof GitHubError && isAuthStatus(failure.httpStatus)
}

function splitRepo(repo: string): { owner: string; name: string } {
  const match = /^([^\s/]+)\/([^\s/]+)$/.exec(repo)
  const owner = match?.[1]
  const name = match?.[2]
  if (owner === undefined || name === undefined) {
    throw new GitHubError(`Invalid repo "${repo}": expected "owner/name"`)
  }
  return { owner, name }
}
