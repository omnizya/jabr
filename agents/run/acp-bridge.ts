import { StdioBridge } from "@adapters/http/stdio-bridge";
import { openJabrDb } from "@adapters/sqlite-db";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store";
import { jabrUrl } from "@config/jabr-config";
import { join } from "node:path";

if (import.meta.main) {
	try {
		// Use JABR_MEMORY_DIR if set, otherwise fall back to process.cwd()/memory
		const memoryDir = process.env.JABR_MEMORY_DIR ?? join(process.cwd(), "memory");
		const bridgeDbPath = join(memoryDir, "jabr-bridge.db");
		const db = openJabrDb(bridgeDbPath);
		const bridge = new StdioBridge({
			orchestratorUrl: jabrUrl(),
			memory: new SqliteMemoryStore(db, { mirrorFile: null }),
		});
		bridge.start();
		process.stderr.write(
			"ACP stdio bridge ready — awaiting IDE connection on stdin\n",
		);
	} catch (e) {
		console.error(`[AcpBridge] failed to start stdio bridge: ${e}`);
		throw e;
	}
}
