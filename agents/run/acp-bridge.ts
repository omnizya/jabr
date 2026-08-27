import { StdioBridge } from "@adapters/http/stdio-bridge";

if (import.meta.main) {
  const bridge = new StdioBridge({
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000",
  });
  bridge.start();
  process.stderr.write(
    "ACP stdio bridge ready — awaiting IDE connection on stdin\n",
  );
}
