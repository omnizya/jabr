/**
 * api-key-registry.ts — Per-key agent allowlists for the orchestrator boundary.
 *
 * Replaces the single shared A2A_AUTH_TOKEN with a proper key registry.
 * Each key carries an allowlist of agent names it may invoke. An empty
 * allowlist means "all agents" (wildcard).
 */

import type { KeyEntry, ResolvedCaller } from "@/types/types";

export class ApiKeyRegistry {
	private readonly keys = new Map<string, KeyEntry>();

	constructor(entries: KeyEntry[]) {
		for (const e of entries) {
			if (!e.key || e.key.length === 0) {
				throw new Error(
					`ApiKeyRegistry: key entry "${e.description}" has empty key`,
				);
			}
			this.keys.set(e.key, { ...e });
		}
	}

	/**
	 * Add a single key to an existing registry. Used to inject legacy
	 * A2A_AUTH_TOKEN alongside A2A_API_KEYS so the orchestrator can
	 * still authenticate when it only has the legacy token.
	 */
	addKey(entry: KeyEntry): void {
		if (!entry.key || entry.key.length === 0) {
			throw new Error(
				`ApiKeyRegistry: key entry "${entry.description}" has empty key`,
			);
		}
		this.keys.set(entry.key, { ...entry });
	}

	/**
	 * Authenticate an API key and return the caller context, or null if the
	 * key is unknown or disabled.
	 */
	authenticate(apiKey: string | null): ResolvedCaller | null {
		if (!apiKey) return null;
		const entry = this.keys.get(apiKey);
		if (!entry) return null;
		if (!entry.enabled) return null;
		return {
			description: entry.description,
			allowedAgents: entry.allowedAgents,
		};
	}

	/**
	 * Check whether a caller may invoke a given agent.
	 *
	 * Returns true when the caller's allowlist is empty (wildcard) or
	 * explicitly includes the agent name.
	 */
	canInvoke(caller: ResolvedCaller, agentName: string): boolean {
		if (caller.allowedAgents.length === 0) return true;
		return caller.allowedAgents.includes(agentName);
	}
}
