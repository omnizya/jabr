/**
 * Outbound port: read/append session memory (Hermes-style append-only markdown).
 * Adapter: filesystem (memory/orchestrator.md).
 */
export interface MemoryStorePort {
  read(): string;
  append(entry: string): void;
}
