import { StdioBridge } from "@adapters/http/stdio-bridge";
import { MemoryFS, DEFAULT_MEMORY_DIR } from "@adapters/memory-fs";

if (import.meta.main) {
  const bridge = new StdioBridge({
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000",
    memory: new MemoryFS({ baseDir: DEFAULT_MEMORY_DIR }),
  });
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge ready — awaiting IDE connection on stdin\n",
  );
}
