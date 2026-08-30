/**
 * build.ts — compile Jabr entry points into standalone binaries.
 *
 * Each target becomes a single self-contained executable in `dist/bin/`
 * (bundled JS + bytecode for faster cold starts). Run with:
 *
 *   bun run build            # build all targets
 *   bun run build -- <name>  # build a single target (e.g. orchestrator)
 *   bun run build -- --list  # list available targets
 *
 * Binary names match the package.json `scripts` keys where applicable so the
 * compiled executables are drop-in replacements for `bun agents/run/<x>.ts`.
 */

import { mkdir, rename } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "dist", "bin");

/**
 * name -> entry point (relative to repo root).
 *
 * `agents/run/*.ts` are the A2A/ACP agent composition roots; `mcp` and `cli`
 * are the tooling entry points. `lifecycle.ts` and `serve.ts` are shared
 * modules, not entry points, so they are intentionally excluded.
 */
const TARGETS: Record<string, string> = {
  orchestrator: "agents/run/orchestrator.ts",
  oracle: "agents/run/oracle.ts",
  librarian: "agents/run/librarian.ts",
  explorer: "agents/run/explorer.ts",
  designer: "agents/run/designer.ts",
  fixer: "agents/run/fixer.ts",
  jarvis: "agents/run/jarvis.ts",
  scientist: "agents/run/scientist.ts",
  verification: "agents/run/verification.ts",
  "acp-bridge": "agents/run/acp-bridge.ts",
  mcp: "mcp-servers/tools.ts",
  cli: "scripts/jabr-cli.ts",
};

/** Targets that pull in heavy native deps and may fail to bundle cleanly. */
const OPTIONAL = new Set(["scientist"]);

function usage(): void {
  console.log("Available build targets:");
  for (const [name, entry] of Object.entries(TARGETS)) {
    const tag = OPTIONAL.has(name) ? "  (optional)" : "";
    console.log(`  ${name.padEnd(14)} ${entry}${tag}`);
  }
}

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function buildTarget(name: string, entry: string): Promise<boolean> {
  const started = performance.now();
  try {
    const result = await Bun.build({
      entrypoints: [join(ROOT, entry)],
      outdir: OUT_DIR,
      target: "bun",
      // `bytecode` defaults to CommonJS, which rejects top-level `await`
      // (used by orchestrator/mcp). Force ESM so bytecode + top-level await
      // coexist.
      format: "esm",
      bytecode: true,
      minify: true,
      sourcemap: "external",
      // Standalone executables should not autoload project config at runtime;
      // env is provided by the operator at launch time.
      compile: {
        autoloadDotenv: true,
        autoloadBunfig: false,
        autoloadTsconfig: false,
        autoloadPackageJson: false,
      },
    });

    if (!result.success) {
      for (const log of result.logs) {
        console.error(`  [${name}] ${log.message}`);
      }
      return false;
    }

    // The compiled executable is the first output artifact. Its basename is
    // derived from the entry point, so normalize it to the target name.
    const artifact = result.outputs[0];
    const produced = artifact?.path;
    if (!produced) {
      console.error(`  [${name}] no output artifact produced`);
      return false;
    }
    const finalPath = join(OUT_DIR, name);
    if (produced !== finalPath) {
      await rename(produced, finalPath);
    }

    const elapsed = (performance.now() - started).toFixed(0);
    const size = (await Bun.file(finalPath).size) ?? 0;
    console.log(`  ✓ ${name.padEnd(14)} ${formatBytes(size).padStart(9)}  (${elapsed}ms)`);
    return true;
  } catch (err) {
    console.error(`  [${name}] build threw: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.includes("-l")) {
    usage();
    return;
  }

  const requested = args.filter((a) => !a.startsWith("-"));
  const names = requested.length > 0 ? requested : Object.keys(TARGETS);

  const unknown = names.filter((n) => !(n in TARGETS));
  if (unknown.length > 0) {
    console.error(`Unknown target(s): ${unknown.join(", ")}`);
    usage();
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Building ${names.length} target(s) -> ${relative(ROOT, OUT_DIR)}/\n`);

  const results: Array<[string, boolean]> = [];
  for (const name of names) {
    const ok = await buildTarget(name, TARGETS[name]!);
    results.push([name, ok]);
  }

  const okCount = results.filter(([, ok]) => ok).length;
  const failed = results.filter(([, ok]) => !ok).map(([n]) => n);

  console.log(`\n${okCount}/${results.length} built successfully.`);
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
