/**
 * Minimal leveled logger shared by Jabr agents.
 *
 * Verbose (debug) output is gated behind `JABR_VERBOSE=true`, which
 * `bun scripts/jabr-cli.ts start [agent|all] --verbose` sets for every
 * spawned agent process. All agent output (verbose included) is captured
 * per-agent into `/tmp/jabr-logs/jabr-<agent>.log` by the CLI.
 *
 * The env flag is read lazily so it can be flipped at runtime (e.g. in
 * tests) and so neither `verbose()` nor `isVerbose()` has any dependence
 * on import order.
 */
export function isVerbose(): boolean {
	const v = process.env.JABR_VERBOSE;
	return v === "true" || v === "1";
}

/** Log a line only when JABR_VERBOSE=true. Otherwise a no-op. */
export function verbose(...args: unknown[]): void {
	if (isVerbose()) {
		console.log(...args);
	}
}
