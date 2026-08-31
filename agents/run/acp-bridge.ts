import { StdioBridge } from "@adapters/http/stdio-bridge";
import { DEFAULT_BRIDGE_DB_PATH, openJabrDb } from "@adapters/sqlite-db";
import { SqliteMemoryStore } from "@adapters/sqlite-memory-store";
import { jabrUrl } from "@config/jabr-config";

if (import.meta.main) {
	try {
		const db = openJabrDb(DEFAULT_BRIDGE_DB_PATH); // memory/jabr-bridge.db
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
