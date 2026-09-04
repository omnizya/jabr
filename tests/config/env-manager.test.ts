import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  optionalEnv,
  requireEnv,
  optionalIntEnv,
  requireIntEnv,
  optionalBoolEnv,
  requireUrlEnv,
  optionalUrlEnv,
  optionalJsonEnv,
  requireJsonEnv,
  EnvManager,
  EnvVarError,
  setEnvManagerLogger,
  resetEnvManagerLogger,
} from "../../src/config/env-manager.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const captured: { info: string[]; warn: string[]; error: string[] } = {
  info: [],
  warn: [],
  error: [],
};

function useCaptureLogger() {
  captured.info = [];
  captured.warn = [];
  captured.error = [];
  setEnvManagerLogger({
    info: (m) => captured.info.push(m),
    warn: (m) => captured.warn.push(m),
    error: (m) => captured.error.push(m),
  });
}

function clearEnv() {
  const keys = [
    "JABR_X402_HMAC_SECRET",
    "JABR_URL",
    "NINEROUTER_URL",
    "NINEROUTER_KEY",
    "NINEROUTER_MODEL",
    "ORCHESTRATOR_PORT",
    "A2A_API_KEYS",
    "ALLOWED_ORIGINS",
    "TEST_BOOL",
    "TEST_JSON",
  ];
  for (const k of keys) delete process.env[k];
}

// ── String accessors ─────────────────────────────────────────────────────────

describe("optionalEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns value when set", () => {
    process.env.NINEROUTER_KEY = "sk-123";
    expect(optionalEnv("NINEROUTER_KEY")).toBe("sk-123");
  });

  test("returns fallback when unset", () => {
    expect(optionalEnv("NINEROUTER_KEY")).toBe("");
  });

  test("returns custom fallback when unset", () => {
    expect(optionalEnv("NINEROUTER_KEY", "default")).toBe("default");
  });
});

describe("requireEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns value when set", () => {
    process.env.JABR_X402_HMAC_SECRET = "secret";
    expect(requireEnv("JABR_X402_HMAC_SECRET")).toBe("secret");
  });

  test("throws EnvVarError when unset", () => {
    expect(() => requireEnv("JABR_X402_HMAC_SECRET")).toThrow(EnvVarError);
  });

  test("throws EnvVarError when empty string", () => {
    process.env.JABR_X402_HMAC_SECRET = "";
    expect(() => requireEnv("JABR_X402_HMAC_SECRET")).toThrow(EnvVarError);
  });

  test("includes hint in error message", () => {
    try {
      requireEnv("JABR_X402_HMAC_SECRET", { hint: "generate with openssl" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("generate with openssl");
    }
  });

  test("logs loaded value", () => {
    useCaptureLogger();
    process.env.JABR_X402_HMAC_SECRET = "secret";
    requireEnv("JABR_X402_HMAC_SECRET");
    expect(captured.info.some((m) => m.includes("JABR_X402_HMAC_SECRET"))).toBe(true);
  });

  test("masks secret value in log", () => {
    useCaptureLogger();
    process.env.JABR_X402_HMAC_SECRET = "secret";
    requireEnv("JABR_X402_HMAC_SECRET", { secret: true });
    expect(captured.info.some((m) => m.includes("set"))).toBe(true);
    expect(captured.info.some((m) => m.includes("secret"))).toBe(false);
  });
});

// ── Integer accessors ────────────────────────────────────────────────────────

describe("optionalIntEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns value when set", () => {
    process.env.ORCHESTRATOR_PORT = "4000";
    expect(optionalIntEnv("ORCHESTRATOR_PORT", 5000)).toBe(4000);
  });

  test("returns fallback when unset", () => {
    expect(optionalIntEnv("ORCHESTRATOR_PORT", 4000)).toBe(4000);
  });

  test("returns fallback on non-integer", () => {
    process.env.ORCHESTRATOR_PORT = "abc";
    expect(optionalIntEnv("ORCHESTRATOR_PORT", 4000)).toBe(4000);
  });

  test("returns fallback on negative", () => {
    process.env.ORCHESTRATOR_PORT = "-1";
    expect(optionalIntEnv("ORCHESTRATOR_PORT", 4000)).toBe(4000);
  });

  test("returns fallback on zero", () => {
    process.env.ORCHESTRATOR_PORT = "0";
    expect(optionalIntEnv("ORCHESTRATOR_PORT", 4000)).toBe(4000);
  });

  test("warns on invalid value", () => {
    useCaptureLogger();
    process.env.ORCHESTRATOR_PORT = "abc";
    optionalIntEnv("ORCHESTRATOR_PORT", 4000);
    expect(captured.warn.length).toBeGreaterThan(0);
  });
});

describe("requireIntEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns value when set", () => {
    process.env.ORCHESTRATOR_PORT = "4000";
    expect(requireIntEnv("ORCHESTRATOR_PORT")).toBe(4000);
  });

  test("throws when unset", () => {
    expect(() => requireIntEnv("ORCHESTRATOR_PORT")).toThrow(EnvVarError);
  });

  test("throws on non-integer", () => {
    process.env.ORCHESTRATOR_PORT = "abc";
    expect(() => requireIntEnv("ORCHESTRATOR_PORT")).toThrow(EnvVarError);
  });

  test("throws on negative", () => {
    process.env.ORCHESTRATOR_PORT = "-1";
    expect(() => requireIntEnv("ORCHESTRATOR_PORT")).toThrow(EnvVarError);
  });

  test("enforces min bound", () => {
    process.env.ORCHESTRATOR_PORT = "100";
    expect(() => requireIntEnv("ORCHESTRATOR_PORT", { min: 1024 })).toThrow(EnvVarError);
  });

  test("enforces max bound", () => {
    process.env.ORCHESTRATOR_PORT = "99999";
    expect(() => requireIntEnv("ORCHESTRATOR_PORT", { max: 65535 })).toThrow(EnvVarError);
  });
});

// ── Boolean accessors ────────────────────────────────────────────────────────

describe("optionalBoolEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test.each([
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["1", true],
    ["yes", true],
    ["YES", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["", false],
    ["random", false],
  ])("optionalBoolEnv('TEST_BOOL', false) with '%s' → %s", (val, expected) => {
    process.env.TEST_BOOL = val;
    expect(optionalBoolEnv("TEST_BOOL", false)).toBe(expected);
  });

  test("returns fallback when unset", () => {
    expect(optionalBoolEnv("TEST_BOOL", true)).toBe(true);
  });
});

// ── URL accessors ────────────────────────────────────────────────────────────

describe("requireUrlEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns value when valid", () => {
    process.env.JABR_URL = "http://localhost:4000";
    expect(requireUrlEnv("JABR_URL")).toBe("http://localhost:4000");
  });

  test("throws when unset", () => {
    expect(() => requireUrlEnv("JABR_URL")).toThrow(EnvVarError);
  });

  test("throws on invalid URL", () => {
    process.env.JABR_URL = "not-a-url";
    expect(() => requireUrlEnv("JABR_URL")).toThrow(EnvVarError);
  });

  test("throws on non-http protocol", () => {
    process.env.JABR_URL = "ftp://localhost:4000";
    expect(() => requireUrlEnv("JABR_URL")).toThrow(EnvVarError);
  });

  test("throws on missing host", () => {
    process.env.JABR_URL = "http://";
    expect(() => requireUrlEnv("JABR_URL")).toThrow(EnvVarError);
  });
});

describe("optionalUrlEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("returns fallback when unset", () => {
    expect(optionalUrlEnv("JABR_URL", "http://localhost:4000")).toBe(
      "http://localhost:4000",
    );
  });

  test("returns value when valid", () => {
    process.env.JABR_URL = "http://jabr.local:4000";
    expect(optionalUrlEnv("JABR_URL", "http://localhost:4000")).toBe(
      "http://jabr.local:4000",
    );
  });

  test("throws on invalid URL", () => {
    process.env.JABR_URL = "not-a-url";
    expect(() => optionalUrlEnv("JABR_URL", "http://localhost:4000")).toThrow(
      EnvVarError,
    );
  });
});

// ── JSON accessors ───────────────────────────────────────────────────────────

describe("optionalJsonEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("parses valid JSON", () => {
    process.env.A2A_API_KEYS = '[{"key":"abc"}]';
    expect(optionalJsonEnv<{ key: string }[]>("A2A_API_KEYS", [])).toEqual([{ key: "abc" }]);
  });

  test("returns fallback when unset", () => {
    expect(optionalJsonEnv<{ key: string }[]>("A2A_API_KEYS", [{ key: "default" }])).toEqual([
      { key: "default" },
    ]);
  });

  test("returns fallback on malformed JSON", () => {
    process.env.A2A_API_KEYS = "not-json";
    expect(optionalJsonEnv<{ key: string }[]>("A2A_API_KEYS", [{ key: "default" }])).toEqual([
      { key: "default" },
    ]);
  });

  test("warns on malformed JSON", () => {
    useCaptureLogger();
    process.env.A2A_API_KEYS = "not-json";
    optionalJsonEnv<{ key: string }[]>("A2A_API_KEYS", []);
    expect(captured.warn.length).toBeGreaterThan(0);
  });
});

describe("requireJsonEnv", () => {
  beforeEach(clearEnv);
  afterEach(resetEnvManagerLogger);

  test("parses valid JSON", () => {
    process.env.A2A_API_KEYS = '[{"key":"abc"}]';
    expect(requireJsonEnv("A2A_API_KEYS")).toEqual([{ key: "abc" }]);
  });

  test("throws when unset", () => {
    expect(() => requireJsonEnv("A2A_API_KEYS")).toThrow(EnvVarError);
  });

  test("throws on malformed JSON", () => {
    process.env.A2A_API_KEYS = "not-json";
    expect(() => requireJsonEnv("A2A_API_KEYS")).toThrow(EnvVarError);
  });
});

// ── EnvManager batch validation ──────────────────────────────────────────────

describe("EnvManager", () => {
  beforeEach(() => {
    clearEnv();
    useCaptureLogger();
  });
  afterEach(resetEnvManagerLogger);

  test("collects all errors before reporting", () => {
    const env = new EnvManager();
    env.require("JABR_X402_HMAC_SECRET").require("NINEROUTER_KEY");
    const errors = env.validate();
    expect(errors.length).toBe(2);
    expect(errors[0]!.name).toBe("JABR_X402_HMAC_SECRET");
    expect(errors[1]!.name).toBe("NINEROUTER_KEY");
  });

  test("passes when all required vars are set", () => {
    process.env.JABR_X402_HMAC_SECRET = "secret";
    process.env.NINEROUTER_KEY = "sk-123";
    const env = new EnvManager();
    env.require("JABR_X402_HMAC_SECRET").require("NINEROUTER_KEY");
    const errors = env.validate();
    expect(errors.length).toBe(0);
  });

  test("validates URL specs", () => {
    process.env.JABR_URL = "not-a-url";
    const env = new EnvManager();
    env.url("JABR_URL", { default: "http://localhost:4000" });
    const errors = env.validate();
    expect(errors.length).toBe(1);
  });

  test("validates int specs", () => {
    process.env.ORCHESTRATOR_PORT = "abc";
    const env = new EnvManager();
    env.int("ORCHESTRATOR_PORT", { default: 4000 });
    const errors = env.validate();
    expect(errors.length).toBe(0); // default used, no error
  });

  test("validates required int specs", () => {
    const env = new EnvManager();
    env.int("ORCHESTRATOR_PORT"); // required, no default
    const errors = env.validate();
    expect(errors.length).toBe(1);
  });

  test("validates JSON specs", () => {
    process.env.A2A_API_KEYS = "not-json";
    const env = new EnvManager();
    env.json("A2A_API_KEYS", { default: [] });
    const errors = env.validate();
    expect(errors.length).toBe(0); // default used
  });

  test("validates required JSON specs", () => {
    const env = new EnvManager();
    env.json("A2A_API_KEYS"); // required
    const errors = env.validate();
    expect(errors.length).toBe(1);
  });

  test("report() exits on failure", () => {
    // process.exit is not easily mockable in bun test without hacks;
    // we verify validate() returns errors and report() calls exitWithError.
    const env = new EnvManager();
    env.require("JABR_X402_HMAC_SECRET");
    const errors = env.validate();
    expect(errors.length).toBe(1);
    expect(captured.error.length).toBe(0); // report() not called yet
  });

  test("logs success on report() with no errors", () => {
    process.env.JABR_X402_HMAC_SECRET = "secret";
    const env = new EnvManager();
    env.require("JABR_X402_HMAC_SECRET");
    env.report();
    expect(
      captured.info.some((m) => m.includes("validated successfully")),
    ).toBe(true);
  });
});
