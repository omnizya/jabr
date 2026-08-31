import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawn as bunSpawn } from "bun";

// ── Integration tests for orchestrator.ts HMAC secret startup validation ──────
//
// These tests spawn the real orchestrator entry point as a subprocess and
// verify its behaviour at startup — without and with JABR_X402_HMAC_SECRET.
// They are isolated: each test uses its own env and cleans up the subprocess.
// The old public default value ("dev-secret-change-in-prod") is NOT used.

const ORCHESTRATOR_ENTRY = join("agents", "run", "orchestrator.ts");

// process.execPath is the absolute path to the current Bun executable — use it
// so subprocesses work even if "bun" is not on the subprocess's $PATH.
const BUN_BIN = process.execPath;

function runOrchestrator(envOverride: Record<string, string>) {
	return bunSpawn({
		cmd: [BUN_BIN, "run", ORCHESTRATOR_ENTRY],
		env: {
			// Provide a fake auth token so the orchestrator passes the auth gate
			// and we only test the HMAC secret gate.
			A2A_AUTH_TOKEN: "test-auth-token-do-not-use-in-prod",
			...envOverride,
		},
		stdout: "pipe",
		stderr: "pipe",
		stdin: "pipe",
	});
}

/** Read a Bun ReadableStream<Uint8Array> to a string. */
async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	reader.releaseLock();
	return chunks.length === 0 ? "" : Buffer.concat(chunks).toString("utf8");
}

describe("Orchestrator startup — JABR_X402_HMAC_SECRET validation", () => {
	test("exits with code 1 and logs expected error when JABR_X402_HMAC_SECRET is not set", async () => {
		// Do NOT set JABR_X402_HMAC_SECRET — the orchestrator should refuse to start.
		const proc = runOrchestrator({});

		const [exitCode, stderr] = await Promise.all([
			proc.exited,
			streamText(proc.stderr as any),
		]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain(
			"Fatal: JABR_X402_HMAC_SECRET environment variable is required",
		);
	});

	test("starts successfully when a valid JABR_X402_HMAC_SECRET is provided", async () => {
		// A non-empty secret is enough to pass the startup gate.  The orchestrator
		// will then attempt to bind ports / connect to downstream infrastructure,
		// which will likely fail in a test environment — that's fine.  We only
		// assert that it does NOT exit immediately with code 1 due to the missing
		// secret check.
		const proc = runOrchestrator({
			JABR_X402_HMAC_SECRET: "test-secret-do-not-use-in-prod",
		});

		// Give the process a brief window to either exit (failure) or keep running
		// (success).  If it exits within this window we capture the exit code and
		// assert it is NOT 1 with the "required" error.
		const didExit = await Promise.race([
			proc.exited.then((code) => ({ exited: true, code })),
			Bun.sleep(2000).then(() => ({ exited: false })),
		]);

		if (didExit.exited) {
			// Process exited early — verify it was NOT the missing-secret failure.
			const stderr = await streamText(proc.stderr as any);
			expect(didExit.code).not.toBe(1);
			expect(stderr).not.toContain(
				"Fatal: JABR_X402_HMAC_SECRET environment variable is required",
			);
		} else {
			// Process stayed alive past the startup gate — kill it cleanly.
			proc.kill();
			// Brief wait to confirm it actually died (no zombie).
			await Bun.sleep(200);
		}
	});
});
