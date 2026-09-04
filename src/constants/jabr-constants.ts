/**
 * Deprecated alias shim. All ecosystem parameters now live in
 * `./ecosystem.ts` (see {@link JABR_PORTS}). Kept only for backward
 * compatibility until every call site migrates.
 */
import { JABR_PORTS } from "./ecosystem.ts";

export { JABR_PORTS };

/**
 * @deprecated Use {@link JABR_PORTS} instead.
 */
export const JABR_WORLD_PORTS = JABR_PORTS;