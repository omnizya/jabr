#!/usr/bin/env -S bun run

/**
 * opensrc-fetch.ts — Pre-fetch dependency source code via the `opensrc` CLI
 * (vercel-labs/opensrc). Reads every package.json in a repo — root plus
 * Turborepo-style workspaces (apps/, packages/, shareds/, libs/, ...) — and
 * fetches each dependency's source into the opensrc cache (~/.opensrc/) so
 * coding agents can inspect real implementations, not just types.
 *
 * Usage:
 *   bun scripts/opensrc-fetch.ts                    # fetch all deps (idempotent)
 *   bun scripts/opensrc-fetch.ts --check            # report unsourced deps, exit 1 if any
 *   bun scripts/opensrc-fetch.ts --dry-run          # show what would be fetched
 *   bun scripts/opensrc-fetch.ts --force            # remove + re-fetch even if cached
 *   bun scripts/opensrc-fetch.ts --prod-only        # skip dev/peer dependencies
 *   bun scripts/opensrc-fetch.ts --cwd <dir>        # scan another repo root
 *   bun scripts/opensrc-fetch.ts --patterns "apps/*,libs/*"  # override workspace globs
 *   bun scripts/opensrc-fetch.ts --verbose          # show opensrc progress output
 *   bun scripts/opensrc-fetch.ts --json             # machine-readable summary
 *
 * Environment:
 *   OPENSRC_BIN   path to the opensrc binary (default: resolves `opensrc` on
 *                 PATH, falling back to ~/.bun/bin/opensrc)
 *
 * Workspace discovery order:
 *   1. --patterns flag
 *   2. package.json "workspaces" (array or { "packages": [...] })
 *   3. turbo.json "workspaces": { "packages": [...] }
 *   4. fallback: apps/*, packages/*, libs/*, shareds/*, shared/*,
 *      services/*, tools/*, components/*
 *
 * Locally-defined workspace packages (matched by name) and file:/link:/
 * workspace:/git: specs are skipped. Version resolution is delegated to
 * opensrc via `--cwd <root>` so it honors the repo lockfile (bun.lock,
 * package-lock.json, yarn.lock, pnpm-lock.yaml).
 *
 * Repo overrides (REPO_OVERRIDES): packages whose npm registry metadata
 * carries no repository URL (opensrc's package-name fetch cannot resolve
 * them — e.g. headroom-ai publishes repository: null). Each entry maps the
 * npm package name to a repo spec opensrc can fetch directly. The fetched
 * tag is `v<installed-version>` (GitHub convention), resolved from the repo
 * `bun.lock` so the cache tracks the pinned lockfile version instead of a
 * rolling default branch. `--check` treats an override as cached when its
 * repo spec appears in the opensrc `repos` index.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ALL_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

const PROD_SECTIONS = ["dependencies", "optionalDependencies"] as const;

const LOCAL_SPEC_PREFIXES = [
	"workspace:",
	"file:",
	"link:",
	"github:",
	"git+",
	"git:",
	"http:",
	"https:",
] as const;

const FALLBACK_PATTERNS = [
	"apps/*",
	"packages/*",
	"libs/*",
	"shareds/*",
	"shared/*",
	"services/*",
	"tools/*",
	"components/*",
] as const;

/**
 * Packages whose npm registry metadata has no repository URL, so opensrc's
 * package-name fetch cannot resolve source. Value is the repo spec opensrc
 * can fetch directly. Fetched at `v<installed-version>` (see repoFetchSpec).
 */
const REPO_OVERRIDES: Record<string, string> = {
	"headroom-ai": "github.com/headroomlabs-ai/headroom",
};

type DepSection = (typeof ALL_SECTIONS)[number];

interface Options {
	cwd: string;
	check: boolean;
	dryRun: boolean;
	force: boolean;
	prodOnly: boolean;
	verbose: boolean;
	json: boolean;
	patterns: string[] | null;
}

interface PkgJson {
	name?: string;
	workspaces?: string[] | { packages?: string[] };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

interface OpenSrcList {
	updatedAt: string;
	packages: Array<{ name: string; version: string; path: string }>;
}

interface SpawnResult {
	status: number;
	stdout: string;
	stderr: string;
}

function usage(): void {
	const text = readFileSync(new URL(import.meta.url), "utf8");
	const start = text.indexOf("*\n") + 2;
	const end = text.indexOf("\n */");
	console.log(text.slice(start, end).replace(/^ \* ?/gm, ""));
}

function parseArgs(args: string[]): Options {
	const opts: Options = {
		cwd: process.cwd(),
		check: false,
		dryRun: false,
		force: false,
		prodOnly: false,
		verbose: false,
		json: false,
		patterns: null,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		switch (arg) {
			case "-h":
			case "--help":
				usage();
				process.exit(0);
				break;
			case "--check":
				opts.check = true;
				break;
			case "--dry-run":
				opts.dryRun = true;
				break;
			case "--force":
				opts.force = true;
				break;
			case "--prod-only":
				opts.prodOnly = true;
				break;
			case "--verbose":
				opts.verbose = true;
				break;
			case "--json":
				opts.json = true;
				break;
			case "--cwd": {
				const next = args[++i];
				opts.cwd = resolve(next ?? ".");
				break;
			}
			case "--patterns": {
				const next = args[++i] ?? "";
				opts.patterns = next
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean);
				break;
			}
			default:
				if (arg.startsWith("-")) {
					console.error(`Unknown option: ${arg}`);
					process.exit(2);
				}
		}
	}
	return opts;
}

// ---------------------------------------------------------------------------
// opensrc CLI helpers

function resolveOpenSrcBin(opts: Options): string | null {
	const fromEnv = process.env.OPENSRC_BIN?.trim();
	if (fromEnv) return fromEnv;
	for (const candidate of ["opensrc", join(homedir(), ".bun/bin/opensrc")]) {
		const r = spawn(candidate, ["--version"], opts);
		if (r.status === 0) return candidate;
	}
	return null;
}

function spawn(bin: string, args: string[], opts: Options): SpawnResult {
	const r = Bun.spawnSync([bin, ...args], {
		cwd: opts.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		status: r.exitCode ?? 1,
		stdout: new TextDecoder().decode(r.stdout),
		stderr: new TextDecoder().decode(r.stderr),
	};
}

function listCached(bin: string, opts: Options): Set<string> {
	const r = spawn(bin, ["list", "--json"], opts);
	if (r.status !== 0) return new Set();
	try {
		const data = JSON.parse(r.stdout) as OpenSrcList & {
			repos?: Array<{ name: string; version: string; path: string }>;
		};
		const cached = new Set((data.packages ?? []).map((p) => p.name));
		const repoKeys = new Set((data.repos ?? []).map((p) => p.name));
		for (const [pkg, repo] of Object.entries(REPO_OVERRIDES)) {
			if (repoKeys.has(repo)) cached.add(pkg);
		}
		return cached;
	} catch {
		return new Set();
	}
}

const NO_REPO_MARKERS = [
	"No repository URL found",
	"may not have its source published",
] as const;

type FetchOutcome = "ok" | "unfetchable" | "failed";

interface FetchResult {
	outcome: FetchOutcome;
	name: string;
	stderr: string;
}

function fetchOne(
	bin: string,
	spec: string,
	name: string,
	opts: Options,
): FetchResult {
	const quiet = opts.verbose ? [] : ["-q"];
	if (opts.force) {
		// Churn the cache so the follow-up fetch actually re-downloads.
		// Overridden packages key their cache entry by the bare repo spec.
		// `remove` takes no -q flag (fetch does).
		const removeSpec = REPO_OVERRIDES[name] ?? name;
		spawn(bin, ["remove", removeSpec], opts);
	}
	const r = spawn(bin, ["fetch", spec, "--cwd", opts.cwd, ...quiet], opts);
	if (opts.verbose && r.stderr.trim()) console.error(r.stderr.trimEnd());
	if (r.status === 0) return { outcome: "ok", name, stderr: "" };
	const stderr = r.stderr.trim();
	// Packages without publishable source metadata (e.g. private npm
	// publishes) can never be fetched — warn instead of failing.
	const unfetchable = NO_REPO_MARKERS.some((m) => stderr.includes(m));
	return { outcome: unfetchable ? "unfetchable" : "failed", name, stderr };
}

// ---------------------------------------------------------------------------
// Discovery

async function findPackageJsonFiles(
	root: string,
	patterns: string[],
): Promise<string[]> {
	const found = new Set<string>();
	for (const pattern of patterns) {
		if (pattern.startsWith("!")) continue; // negation globs unsupported
		const glob = new Bun.Glob(`${pattern.replace(/\/+$/, "")}/package.json`);
		for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
			if (rel.split("/").includes("node_modules")) continue;
			found.add(resolve(root, rel));
		}
	}
	return [...found].sort();
}

function readPkgJson(file: string): PkgJson | null {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as PkgJson;
	} catch (err) {
		console.error(`⚠  Skipping unparseable ${file}: ${(err as Error).message}`);
		return null;
	}
}

function isLocalSpec(spec: string): boolean {
	return LOCAL_SPEC_PREFIXES.some((prefix) => spec.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Repo override helpers

/** Installed versions resolved from bun.lock v2 (JSON): packages["name"][0] is
 *  "<name>@<version>". Empty map when the repo has no parseable bun.lock. */
function resolveInstalledVersions(cwd: string): Map<string, string> {
	const versions = new Map<string, string>();
	try {
		const lockPath = join(cwd, "bun.lock");
		if (!existsSync(lockPath)) return versions;
		const lock = JSON.parse(
			// bun.lock writes trailing commas; strict JSON.parse rejects them
			readFileSync(lockPath, "utf8").replace(/,\s*([}\]])/g, "$1"),
		) as {
			packages?: Record<string, unknown>;
		};
		for (const [name, entry] of Object.entries(lock.packages ?? {})) {
			const head = Array.isArray(entry) ? (entry[0] as string) : "";
			const at = head.lastIndexOf("@");
			if (at > 0) versions.set(name, head.slice(at + 1));
		}
	} catch {
		return versions;
	}
	return versions;
}

/** Effective opensrc fetch spec for a dependency: the npm name, or for
 *  overridden packages the repo spec pinned to `v<installed-version>` (bare
 *  repo spec when the version is unknown — fetches the default branch). */
function repoFetchSpec(
	name: string,
	versions: Map<string, string>,
): string | null {
	const repo = REPO_OVERRIDES[name];
	if (!repo) return null;
	const version = versions.get(name);
	return version ? `${repo}@v${version}` : repo;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));

	const bin = resolveOpenSrcBin(opts);
	if (!bin) {
		console.error(
			"opensrc binary not found. Install it (bun add -g opensrc or npm i -g opensrc) " +
				"or set OPENSRC_BIN.",
		);
		process.exit(1);
	}

	const rootPkgPath = join(opts.cwd, "package.json");
	if (!existsSync(rootPkgPath)) {
		console.error(`No package.json found at ${opts.cwd} (use --cwd).`);
		process.exit(1);
	}
	const rootPkg = readPkgJson(rootPkgPath);
	if (!rootPkg) process.exit(1);

	// 1. Workspace patterns — flag > package.json workspaces > turbo.json >
	//    well-known monorepo dirs.
	let patterns: string[];
	let patternsSource: string;
	if (opts.patterns) {
		patterns = opts.patterns;
		patternsSource = "--patterns";
	} else {
		const ws = rootPkg.workspaces;
		if (Array.isArray(ws)) {
			patterns = ws;
			patternsSource = "package.json workspaces";
		} else if (ws && Array.isArray(ws.packages)) {
			patterns = ws.packages;
			patternsSource = "package.json workspaces.packages";
		} else {
			const turboPath = join(opts.cwd, "turbo.json");
			if (existsSync(turboPath)) {
				const turbo = readPkgJson(turboPath) as PkgJson & {
					workspaces?: { packages?: string[] };
				};
				if (turbo.workspaces?.packages) {
					patterns = turbo.workspaces.packages;
					patternsSource = "turbo.json workspaces.packages";
				} else {
					patterns = [...FALLBACK_PATTERNS];
					patternsSource = "default (no workspace config)";
				}
			} else {
				patterns = [...FALLBACK_PATTERNS];
				patternsSource = "default (no workspace config)";
			}
		}
	}

	// 2. Read every workspace package.json (+ the root, which is implicit).
	const files = [
		rootPkgPath,
		...(await findPackageJsonFiles(opts.cwd, patterns)),
	];
	const packages: Array<{ file: string; json: PkgJson }> = [];
	const localNames = new Set<string>();
	for (const file of files) {
		const json = readPkgJson(file);
		if (!json) continue;
		if (json.name) localNames.add(json.name);
		packages.push({ file, json });
	}

	// 3. Collect dependency specs, skipping workspace-local packages and
	//    non-registry specs.
	const sections: readonly DepSection[] = opts.prodOnly
		? PROD_SECTIONS
		: ALL_SECTIONS;
	const depSpecs = new Map<string, string>(); // name -> requested spec
	for (const { json } of packages) {
		for (const section of sections) {
			const sec = json[section];
			if (!sec) continue;
			for (const [name, spec] of Object.entries(sec)) {
				if (localNames.has(name) || isLocalSpec(spec)) continue;
				if (!depSpecs.has(name)) depSpecs.set(name, spec);
			}
		}
	}

	const deps = [...depSpecs.keys()].sort();
	const installed = deps.some((d) => REPO_OVERRIDES[d])
		? resolveInstalledVersions(opts.cwd)
		: new Map<string, string>();
	const fetchSpecOf = (name: string): string =>
		repoFetchSpec(name, installed) ?? name;
	const cached = opts.force ? new Set<string>() : listCached(bin, opts);
	const missing = deps.filter((d) => !cached.has(d));

	if (opts.json) {
		const payload = {
			root: opts.cwd,
			bin,
			workspacePatterns: patterns,
			patternsSource,
			packageJsonFiles: packages.map((p) => p.file),
			packageCount: packages.length,
			depCount: deps.length,
			deps: Object.fromEntries(
				deps.map((d) => [
					d,
					{
						spec: depSpecs.get(d) ?? "",
						cached: cached.has(d),
						repo: REPO_OVERRIDES[d] ?? null,
					},
				]),
			),
			cachedCount: deps.length - missing.length,
			missing,
		};
		console.log(JSON.stringify(payload, null, 2));
		if (opts.check) process.exit(missing.length > 0 ? 1 : 0);
		if (opts.dryRun) process.exit(0);
		// fall through to fetch in json mode
	} else {
		console.log(`opensrc: ${bin}`);
		console.log(`workspaces: ${patternsSource}`);
		for (const p of patterns) console.log(`  - ${p}`);
		console.log(
			`package.json files: ${packages.length} (root + ${packages.length - 1} workspace)`,
		);
		console.log(
			`dependencies: ${deps.length} total, ${deps.length - missing.length} already cached`,
		);
	}

	if (opts.check) {
		if (missing.length === 0) {
			if (!opts.json) console.log("\nAll dependencies sourced. ✓");
			process.exit(0);
		}
		if (!opts.json) {
			console.log(`\nMissing from opensrc cache: ${missing.length}`);
			console.log("─".repeat(80));
			for (const name of missing) {
				console.log(`  ${name}  (${depSpecs.get(name) ?? ""})`);
			}
		}
		process.exit(1);
	}

	if (opts.dryRun) {
		if (!opts.json) {
			console.log(`\nWould fetch ${missing.length} package(s):`);
			for (const name of missing) console.log(`  ${name}`);
			if (opts.force)
				console.log("\n(--force: also re-fetching cached packages)");
		}
		process.exit(0);
	}

	const target = opts.force ? deps : missing;
	if (target.length === 0) {
		if (!opts.json)
			console.log("\nNothing to fetch — all dependencies sourced. ✓");
		process.exit(0);
	}

	// 4. Fetch per package: opensrc exits non-zero if ANY member of a batch
	//    fails, so batching would misattribute failures. Per-package it is
	//    idempotent (cache hits are skipped fast).
	let ok = 0;
	const unfetchable: FetchResult[] = [];
	const failed: FetchResult[] = [];
	for (const [i, name] of target.entries()) {
		if (!opts.json && !opts.verbose) {
			process.stdout.write(`\rfetching ${i + 1}/${target.length} (${name})...`);
		}
		const res = fetchOne(bin, fetchSpecOf(name), name, opts);
		if (res.outcome === "ok") ok++;
		else if (res.outcome === "unfetchable") unfetchable.push(res);
		else failed.push(res);
	}
	if (!opts.json && target.length > 0)
		process.stdout.write("\r" + " ".repeat(60) + "\r");

	if (opts.json) {
		console.log(
			JSON.stringify({
				root: opts.cwd,
				ok,
				unfetchable: unfetchable.map((r) => ({
					name: r.name,
					stderr: r.stderr,
				})),
				failed: failed.map((r) => ({ name: r.name, stderr: r.stderr })),
				failedCount: failed.length,
				alreadyCached: deps.length - target.length,
			}),
		);
	} else {
		console.log("");
		console.log("─".repeat(80));
		console.log(`✓ ${ok} fetched`);
		if (unfetchable.length > 0) {
			console.log(`⚑ ${unfetchable.length} no source published (skipped):`);
			for (const r of unfetchable)
				console.log(
					`  - ${r.name}${r.stderr ? ` — ${r.stderr.slice(0, 120)}` : ""}`,
				);
		}
		if (failed.length > 0) {
			console.log(`✗ ${failed.length} failed:`);
			for (const r of failed)
				console.log(
					`  - ${r.name}${r.stderr ? ` — ${r.stderr.slice(0, 120)}` : ""}`,
				);
		}
	}

	process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
