import { StdioBridge } from "@adapters/http/stdio-bridge";
import { MemoryFS } from "@adapters/memory-fs";

if (import.meta.main) {
  const bridge = new StdioBridge({
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000",
    memory: new MemoryFS(),
  });
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge ready — awaiting IDE connection on stdin\n",
  );
}
