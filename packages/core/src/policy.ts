import { Policy, PolicyRule } from './types';

export interface PolicyEngineOptions {
  /**
   * What to do when no rule matches.
   * - `'allow'` (default): permissive — useful for local dev.
   * - `'deny'`: strict — recommended for production / multi-tenant deployments.
   */
  defaultEffect?: 'allow' | 'deny';
}

/**
 * Policy engine: evaluates a list of rules against the permissions and
 * parameters of a proposed tool call.
 *
 * Evaluation order:
 *   1. If any enabled policy has a matching `deny` rule, the call is denied.
 *   2. Otherwise, if any enabled policy has a matching `allow` rule, it is allowed.
 *   3. Otherwise, the configured `defaultEffect` is returned.
 *
 * Deny-first ordering means that broad "allow *" rules cannot shadow a
 * narrower explicit deny.
 */
export class PolicyEngine {
  private policies: Map<string, Policy> = new Map();
  private readonly defaultEffect: 'allow' | 'deny';

  constructor(options: PolicyEngineOptions = {}) {
    this.defaultEffect = options.defaultEffect ?? 'allow';
  }

  async check(permissions: string[], params: Record<string, any>): Promise<boolean> {
    let allowHit = false;

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      for (const rule of policy.rules) {
        if (!this.matchesRule(rule, permissions, params)) continue;
        if (rule.effect === 'deny') {
          return false;
        }
        if (rule.effect === 'allow') {
          allowHit = true;
        }
      }
    }

    if (allowHit) return true;
    return this.defaultEffect === 'allow';
  }

  private matchesRule(
    rule: PolicyRule,
    permissions: string[],
    _params: Record<string, any>,
  ): boolean {
    const resourceMatch =
      rule.resource === '*' ||
      permissions.some(p => {
        if (rule.resource.endsWith('*')) {
          return p.startsWith(rule.resource.slice(0, -1));
        }
        return p === rule.resource;
      });

    const actionMatch = rule.action === '*';
    return resourceMatch && actionMatch;
  }

  addPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
  }

  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  getPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }
}
