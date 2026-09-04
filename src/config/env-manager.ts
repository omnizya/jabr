/**
 * env-manager.ts — typed environment variable accessors with error handling,
 * logging, and batch validation.
 *
 * The codebase reads `process.env` directly in dozens of places with ad-hoc
 * defaults and error messages. This module centralizes every pattern behind
 * a consistent API that:
 *
 *   1. Logs at the right level (info/warn/error) with a `[EnvManager]` prefix.
 *   2. Fails fast on missing required variables with a clear error + hint.
 *   3. Validates and coerces types (int, boolean, URL, JSON).
 *   4. Collects all errors before exiting so startup surfaces every problem
 *      at once instead of one-at-a-time.
 *
 * Quick usage:
 *
 *   // Required string — exits if unset.
 *   const hmac = requireEnv("JABR_X402_HMAC_SECRET");
 *
 *   // Optional with default.
 *   const model = optionalEnv("NINEROUTER_MODEL", "openrouter/minimax/minimax-m3:free");
 *
 *   // Integer port.
 *   const port = optionalIntEnv("ORCHESTRATOR_PORT", 4000);
 *
 *   // URL with validation.
 *   const url = requireUrlEnv("JABR_URL");
 *
 *   // Batch validate many at startup:
 *   const env = new EnvManager();
 *   env.require("JABR_X402_HMAC_SECRET");
 *   env.url("JABR_URL", "http://localhost:4000");
 *   env.int("ORCHESTRATOR_PORT", 4000);
 *   env.report(); // logs all problems, exits if any failed
 */

// ---------------------------------------------------------------------------
// Internal logger — matches the codebase's bracket-prefix convention.
// ---------------------------------------------------------------------------

export interface Logger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

export const defaultLogger: Logger = {
	info: (msg) => console.log(`[EnvManager] ${msg}`),
	warn: (msg) => console.warn(`[EnvManager] ${msg}`),
	error: (msg) => console.error(`[EnvManager] ${msg}`),
};

export let logger: Logger = defaultLogger;

/** Override the default logger (useful for tests or custom sinks). */
export function setEnvManagerLogger(l: Logger): void {
	logger = l;
}

/** Reset to the default console logger. */
export function resetEnvManagerLogger(): void {
	logger = defaultLogger;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EnvVarError extends Error {
	constructor(
		public override readonly name: string,
		message: string,
	) {
		super(message);
		this.name = name;
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function exitWithError(messages: string[]): never {
	for (const m of messages) {
		logger.error(m);
	}
	process.exit(1);
}

// ---------------------------------------------------------------------------
// String accessors
// ---------------------------------------------------------------------------

/** Return `name`'s value, or `fallback` if unset. Never throws. */
export function optionalEnv(name: string, fallback = ""): string {
	return process.env[name] ?? fallback;
}

/**
 * Return `name`'s value or throw {@link EnvVarError}. Use this when a
 * missing variable makes the process unrunnable.
 *
 * @param opts.hint  Appended to the error message to help the operator fix it.
 * @param opts.secret  When true, the value is masked in logs (show "set" vs "missing").
 */
export function requireEnv(
	name: string,
	opts: { hint?: string; secret?: boolean } = {},
): string {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		const hint = opts.hint ? ` — ${opts.hint}` : "";
		throw new EnvVarError(
			name,
			`Fatal: ${name} environment variable is required${hint}`,
		);
	}
	logger.info(
		`loaded ${name} (${opts.secret ? (raw.length > 0 ? "set" : "empty") : raw})`,
	);
	return raw;
}

// ---------------------------------------------------------------------------
// Integer accessors
// ---------------------------------------------------------------------------

/** Parse `name` as an integer, returning `fallback` if unset/invalid. */
export function optionalIntEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		logger.warn(
			`${name}="${raw}" is not a positive integer — using default ${fallback}`,
		);
		return fallback;
	}
	return n;
}

/**
 * Parse `name` as a positive integer, throwing {@link EnvVarError} on
 * missing or invalid input.
 */
export function requireIntEnv(
	name: string,
	opts: { hint?: string; min?: number; max?: number } = {},
): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		throw new EnvVarError(
			name,
			`Fatal: ${name} environment variable is required (expected integer)`,
		);
	}
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		throw new EnvVarError(
			name,
			`Fatal: ${name}="${raw}" must be a positive integer`,
		);
	}
	if (opts.min !== undefined && n < opts.min) {
		throw new EnvVarError(
			name,
			`Fatal: ${name}=${n} is below minimum ${opts.min}`,
		);
	}
	if (opts.max !== undefined && n > opts.max) {
		throw new EnvVarError(
			name,
			`Fatal: ${name}=${n} exceeds maximum ${opts.max}`,
		);
	}
	logger.info(`loaded ${name}=${n}`);
	return n;
}

// ---------------------------------------------------------------------------
// Boolean accessors
// ---------------------------------------------------------------------------

/** Parse `name` as a boolean. Accepts "true"/"1"/"yes" (case-insensitive) as true. */
export function optionalBoolEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	return /^(true|1|yes)$/i.test(raw.trim());
}

// ---------------------------------------------------------------------------
// URL accessors
// ---------------------------------------------------------------------------

/**
 * Parse `name` as a valid URL. Throws on missing/invalid values when
 * required, or returns `fallback` when optional.
 */
export function requireUrlEnv(name: string): string {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		throw new EnvVarError(
			name,
			`Fatal: ${name} environment variable is required`,
		);
	}
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			throw new Error("invalid protocol");
		}
		if (u.hostname.length === 0) {
			throw new Error("missing host");
		}
		logger.info(`loaded ${name}=${raw}`);
		return raw;
	} catch (e) {
		throw new EnvVarError(
			name,
			`Fatal: ${name}="${raw}" is not a valid http(s) URL (${(e as Error).message})`,
		);
	}
}

/**
 * Parse `name` as a valid URL, returning `fallback` if unset.
 * Still throws if the value is set but invalid.
 */
export function optionalUrlEnv(name: string, fallback: string): string {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			throw new Error("invalid protocol");
		}
		return raw;
	} catch (e) {
		throw new EnvVarError(
			name,
			`Fatal: ${name}="${raw}" is not a valid http(s) URL (${(e as Error).message})`,
		);
	}
}

// ---------------------------------------------------------------------------
// JSON accessors
// ---------------------------------------------------------------------------

/** Parse `name` as JSON, returning `fallback` if unset or malformed. */
export function optionalJsonEnv<T>(name: string, fallback: T): T {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch (e) {
		logger.warn(
			`${name} is not valid JSON (${(e as Error).message}) — using default`,
		);
		return fallback;
	}
}

/**
 * Parse `name` as JSON, throwing {@link EnvVarError} on missing/malformed input.
 */
export function requireJsonEnv<T>(name: string): T {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		throw new EnvVarError(
			name,
			`Fatal: ${name} environment variable is required (expected JSON)`,
		);
	}
	try {
		return JSON.parse(raw) as T;
	} catch (e) {
		throw new EnvVarError(
			name,
			`Fatal: ${name} is not valid JSON (${(e as Error).message})`,
		);
	}
}

// ---------------------------------------------------------------------------
// EnvManager — batch validation collector
// ---------------------------------------------------------------------------

export interface SpecEntry {
	name: string;
	required: boolean;
	validate: () => void;
	error?: EnvVarError;
}

/**
 * Collects env var validation specs, runs them all, and reports every
 * failure at once. Best used at startup to surface all missing/invalid
 * configuration in a single pass.
 *
 * ```
 * const env = new EnvManager();
 * env.require("JABR_X402_HMAC_SECRET");
 * env.string("JABR_URL", { default: "http://localhost:4000" });
 * env.int("ORCHESTRATOR_PORT", { default: 4000 });
 * env.url("NINEROUTER_URL", { default: "http://localhost:20127" });
 * env.json<A2AKey[]>("A2A_API_KEYS", { default: [] });
 * env.report(); // exits non-zero if any spec failed
 * ```
 */
export class EnvManager {
	private specs: SpecEntry[] = [];

	/** Mark a string var as required (must be non-empty). */
	require(name: string, hint?: string): this {
		const idx = this.specs.length;
		this.specs.push({
			name,
			required: true,
			validate: () => {
				try {
					requireEnv(name, { hint });
				} catch (e) {
					this.specs[idx]!.error = e as EnvVarError;
				}
			},
		});
		return this;
	}

	/** Declare a string var with a default fallback. */
	string(name: string, opts: { default?: string } = {}): this {
		this.specs.push({
			name,
			required: false,
			validate: () => {
				const v = optionalEnv(name, opts.default ?? "");
				if (opts.default === undefined && !process.env[name]) {
					logger.info(`${name} is unset (no default provided)`);
				} else {
					logger.info(`loaded ${name}=${v}`);
				}
			},
		});
		return this;
	}

	/** Declare an integer var (required if `default` is undefined). */
	int(
		name: string,
		opts: { default?: number; min?: number; max?: number } = {},
	): this {
		const required = opts.default === undefined;
		const idx = this.specs.length;
		this.specs.push({
			name,
			required,
			validate: () => {
				if (required) {
					try {
						requireIntEnv(name, { min: opts.min, max: opts.max });
					} catch (e) {
						this.specs[idx]!.error = e as EnvVarError;
					}
				} else {
					const v = optionalIntEnv(name, opts.default!);
					logger.info(`loaded ${name}=${v}`);
				}
			},
		});
		return this;
	}

	/** Declare a boolean var (defaults to false unless overridden). */
	boolean(name: string, defaultValue = false): this {
		this.specs.push({
			name,
			required: false,
			validate: () => {
				const v = optionalBoolEnv(name, defaultValue);
				logger.info(`loaded ${name}=${v}`);
			},
		});
		return this;
	}

	/** Declare a URL var (http/https only). */
	url(name: string, opts: { default?: string } = {}): this {
		const required = opts.default === undefined;
		const idx = this.specs.length;
		this.specs.push({
			name,
			required,
			validate: () => {
				if (required) {
					try {
						requireUrlEnv(name);
					} catch (e) {
						this.specs[idx]!.error = e as EnvVarError;
					}
				} else {
					try {
						const v = optionalUrlEnv(name, opts.default!);
						logger.info(`loaded ${name}=${v}`);
					} catch (e) {
						this.specs[idx]!.error = e as EnvVarError;
					}
				}
			},
		});
		return this;
	}

	/** Declare a JSON var (parsed with fallback). */
	json<T>(name: string, opts: { default?: T } = {}): this {
		const required = opts.default === undefined;
		const idx = this.specs.length;
		this.specs.push({
			name,
			required,
			validate: () => {
				if (required) {
					try {
						requireJsonEnv<T>(name);
					} catch (e) {
						this.specs[idx]!.error = e as EnvVarError;
					}
				} else {
					const v = optionalJsonEnv<T>(name, opts.default!);
					logger.info(`loaded ${name}=${JSON.stringify(v)}`);
				}
			},
		});
		return this;
	}

	/** Run every registered spec. Collects errors instead of exiting. */
	validate(): EnvVarError[] {
		for (const s of this.specs) s.validate();
		return this.specs.filter((s) => s.error).map((s) => s.error!);
	}

	/** Validate and report: logs all failures and exits non-zero if any failed. */
	report(): void {
		const errors = this.validate();
		if (errors.length > 0) {
			exitWithError(errors.map((e) => e.message));
		}
		logger.info(`all ${this.specs.length} env var(s) validated successfully`);
	}
}
