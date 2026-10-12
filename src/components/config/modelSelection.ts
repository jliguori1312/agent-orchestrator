// Maps a host-config role to the concrete provider/model C5 passes to pi, and
// names the credential the host loads for that provider. Pure and boundary-free
// so the tick entrypoint (PR 7) can assemble an AgentSessionSpec without
// re-deriving the naming rule, and so the role→credential contract is pinned by
// tests before any session runs.
import type { RoleName } from '../../prompts/role.js'
import type { HostConfig } from './hostConfigSchema.js'

export interface RoleModel {
  readonly provider: string
  readonly model: string
}

// Every role draws its provider from the single configured `model.provider`;
// only the model id varies per role.
export function modelForRole(config: HostConfig, role: RoleName): RoleModel {
  return { provider: config.model.provider, model: config.model[role] }
}

// The host loads the model key under "<provider>-key" (LoadCredential=,
// ADR-0004), so switching providers without provisioning the matching
// credential fails fast rather than sending the old key to a new provider.
export function credentialNameForProvider(provider: string): string {
  return `${provider}-key`
}
