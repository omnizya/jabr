import type { PluginRegistryUseCase } from "@core/plugin-registry";
import {
	createPluginRegistryUseCase,
	type PluginContextDeps,
} from "@core/plugin-registry";
import type { IPlugin, PluginExport, PluginMetadata } from "@ports/plugin";
import type { DomainEventBus } from "@ports/plugin-event-bus.types";

// =============================================================================
// Plugin Loader Types
// =============================================================================

export interface PluginLoaderOptions {
	/** Root directory to scan for plugin bundles */
	pluginsDir?: string;
	/** Optional custom registry (for testing) */
	registry?: PluginRegistryUseCase;
	/** Optional custom event bus (for testing) */
	eventBus?: DomainEventBus;
}

export interface LoadedPluginInfo {
	name: string;
	version: string;
	path: string;
	state: "discovered" | "loaded" | "error";
	error?: string;
}

export interface PluginLoaderResult {
	plugins: LoadedPluginInfo[];
	registry: PluginRegistryUseCase;
	eventBus: DomainEventBus;
}

// =============================================================================
// BunDynamicPluginLoaderAdapter
// =============================================================================

/**
 * BunDynamicPluginLoaderAdapter — scans a directory for plugin bundles,
 * dynamically imports them, validates structure, and registers with the
 * PluginRegistryUseCase.
 *
 * Each plugin bundle is expected to be a directory containing an index.ts
 * (or index.js) that exports either:
 *   - a `createPlugin()` factory function, OR
 *   - a default export that is an IPlugin instance
 *
 * Error isolation: each plugin is loaded in its own try/catch so one bad
 * plugin doesn't prevent others from loading.
 */
export class BunDynamicPluginLoaderAdapter {
	private readonly pluginsDir: string;
	private readonly registry: PluginRegistryUseCase;
	private readonly eventBus: DomainEventBus;
	private readonly logger: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
		debug?: (msg: string) => void;
	};

	constructor(deps: PluginContextDeps, options: PluginLoaderOptions = {}) {
		this.pluginsDir =
			options.pluginsDir ?? new URL("../../plugins", import.meta.url).pathname;
		this.eventBus = options.eventBus ?? deps.eventBus;
		this.registry = options.registry ?? createPluginRegistryUseCase(deps);
		this.logger = deps.logger;
	}

	/**
	 * Scan the plugins directory, load and register all valid plugins.
	 * Returns a summary of what was loaded.
	 */
	async loadAll(): Promise<PluginLoaderResult> {
		const plugins: LoadedPluginInfo[] = [];

		// Ensure plugins directory exists
		try {
			const dir = await import("fs/promises");
			await dir.mkdir(this.pluginsDir, { recursive: true });
		} catch {
			// Directory might already exist
		}

		// Read directory entries
		let entries: string[];
		try {
			const dir = await import("fs/promises");
			entries = await dir.readdir(this.pluginsDir);
		} catch (e) {
			this.logger.warn(
				`[PluginLoader] Could not read plugins directory: ${String(e)}`,
			);
			return { plugins, registry: this.registry, eventBus: this.eventBus };
		}

		// Process each entry as a potential plugin bundle
		for (const entry of entries) {
			const pluginPath = `${this.pluginsDir}/${entry}`;
			const result = await this.loadPlugin(entry, pluginPath);
			plugins.push(result);
		}

		this.logger.info(
			`[PluginLoader] Loaded ${plugins.filter((p) => p.state === "loaded").length} of ${plugins.length} plugin(s)`,
		);
		return { plugins, registry: this.registry, eventBus: this.eventBus };
	}

	/**
	 * Load a single plugin from a directory.
	 * Validates the bundle structure and registers with the registry.
	 */
	async loadPlugin(
		name: string,
		pluginPath: string,
	): Promise<LoadedPluginInfo> {
		// Check if it's a directory (plugin bundle)
		let stat;
		try {
			const fs = await import("fs/promises");
			stat = await fs.stat(pluginPath);
		} catch {
			return {
				name,
				version: "unknown",
				path: pluginPath,
				state: "error",
				error: "Not a valid plugin directory",
			};
		}

		if (!stat.isDirectory()) {
			return {
				name,
				version: "unknown",
				path: pluginPath,
				state: "error",
				error: "Plugin must be a directory",
			};
		}

		// Find the entry point (index.ts or index.js)
		let entryPoint: string | null = null;
		for (const ext of [".ts", ".js"]) {
			try {
				const fs = await import("fs/promises");
				await fs.access(`${pluginPath}/index${ext}`);
				entryPoint = `${pluginPath}/index${ext}`;
				break;
			} catch {
				// Try next extension
			}
		}

		if (!entryPoint) {
			return {
				name,
				version: "unknown",
				path: pluginPath,
				state: "error",
				error: "No index.ts or index.js found",
			};
		}

		// Dynamic import with error isolation
		let pluginExport: PluginExport;
		let metadata: PluginMetadata;

		try {
			const module = await import(entryPoint);

			// Support both factory function and raw instance exports
			if (typeof module.createPlugin === "function") {
				pluginExport = module.createPlugin;
			} else if (
				module.default &&
				(typeof module.default === "function" ||
					typeof module.default === "object")
			) {
				pluginExport = module.default;
			} else {
				throw new Error(
					"Plugin must export either createPlugin() factory or default IPlugin instance",
				);
			}

			// Extract metadata for reporting (without full validation - registry does that)
			const tempPlugin =
				typeof pluginExport === "function" ? pluginExport() : pluginExport;
			metadata = tempPlugin.metadata;

			// Register with registry (does full validation)
			const result = await this.registry.register(pluginExport);
			if (!result.success) {
				return {
					name,
					version: metadata.version,
					path: pluginPath,
					state: "error",
					error: result.error,
				};
			}

			this.logger.info(
				`[PluginLoader] Loaded plugin: ${metadata.name}@${metadata.version} from ${entryPoint}`,
			);
			return {
				name: metadata.name,
				version: metadata.version,
				path: pluginPath,
				state: "loaded",
			};
		} catch (e) {
			const error = `Failed to load plugin: ${String(e)}`;
			this.logger.error(`[PluginLoader] ${error} (${pluginPath})`);
			return {
				name,
				version: "unknown",
				path: pluginPath,
				state: "error",
				error,
			};
		}
	}

	/**
	 * Initialize all registered plugins.
	 * Should be called after loadAll().
	 */
	async initializeAll(): Promise<void> {
		await this.registry.initializeAll();
	}

	/**
	 * Shutdown all plugins gracefully.
	 */
	async shutdownAll(): Promise<void> {
		await this.registry.shutdownAll();
	}

	/**
	 * Get the registry for direct access.
	 */
	getRegistry(): PluginRegistryUseCase {
		return this.registry;
	}

	/**
	 * Get the event bus for external emitters.
	 */
	getEventBus(): DomainEventBus {
		return this.eventBus;
	}
}

// =============================================================================
// Factory Function
// =============================================================================

export function createPluginLoader(
	deps: PluginContextDeps,
	options?: PluginLoaderOptions,
): BunDynamicPluginLoaderAdapter {
	return new BunDynamicPluginLoaderAdapter(deps, options);
}
