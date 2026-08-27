export interface MemoryStorePort {
  read(): string;
  append(entry: string): void;
}
