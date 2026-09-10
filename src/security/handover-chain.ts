/**
 * handover-chain.ts — Circular handoff detection for agent-to-agent transfers.
 *
 * Tracks the chain of agents in a handover sequence and detects cycles.
 * If agent A → B → A is detected, the handover is rejected and the task
 * fails with a clear error.
 */

/**
 * Detects whether adding a new agent to the handover chain would create a cycle.
 *
 * @param chain  Current chain of agent names (in order of handover)
 * @param next   The agent being handed off to
 * @returns      True if adding `next` would create a cycle
 */
export function wouldCreateCycle(chain: string[], next: string): boolean {
	return chain.includes(next);
}

/**
 * Builds the handover chain for a new child task.
 * Returns a new array with the current agent appended.
 *
 * @param currentChain  The parent task's handover chain
 * @param agentName     The agent that just performed the handover
 * @returns             New chain including the current agent
 */
export function extendChain(
	currentChain: string[],
	agentName: string,
): string[] {
	return [...currentChain, agentName];
}

/**
 * Formats the handover chain as a human-readable string for error messages.
 *
 * @param chain  The handover chain
 * @returns      Formatted string like "oracle → fixer → oracle"
 */
export function formatChain(chain: string[]): string {
	return chain.join(" → ");
}

/**
 * Creates a circular handoff error with a clear message.
 *
 * @param chain     The handover chain that contains the cycle
 * @param nextAgent The agent that would complete the cycle
 * @returns         Error with descriptive message
 */
export function createCircularHandoffError(
	chain: string[],
	nextAgent: string,
): Error {
	const chainStr = formatChain([...chain, nextAgent]);
	return new Error(
		`Circular handoff detected: ${chainStr}. ` +
			`Rejecting handover to prevent infinite loop. ` +
			`The task has been failed. Please rephrase the task or route to a different agent.`,
	);
}
