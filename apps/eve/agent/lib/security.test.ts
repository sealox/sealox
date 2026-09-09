import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSafeSandboxCommand,
  inheritedSandboxEnvironment,
  redactSensitiveText
} from "./security.ts";

test("redacts credentials from development logs", () => {
  const token = `gho_${"a".repeat(36)}`;
  const input = `docker login ghcr.io -u user -p ${token}; API_TOKEN=secret`;
  const redacted = redactSensitiveText(input);

  assert.doesNotMatch(redacted, /gho_/);
  assert.doesNotMatch(redacted, /API_TOKEN=secret/);
  assert.match(redacted, /docker login .* -p \[REDACTED\]/);
})

test("allows a direct credential pipe without returning the token to the model", () => {
  assert.doesNotThrow(() =>
    assertSafeSandboxCommand(
      'gh auth token | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin'
    )
  );
})

test("rejects commands that expose or embed credentials", () => {
  const token = `gho_${"b".repeat(36)}`;
  assert.throws(() => assertSafeSandboxCommand("gh auth token"), /只能直接管道/);
  assert.throws(
    () => assertSafeSandboxCommand(`docker login ghcr.io -u user -p ${token}`),
    /明文凭证/
  );
  assert.throws(
    () => assertSafeSandboxCommand("docker login ghcr.io -u user --password secret"),
    /password-stdin/
  );
})

test("does not inherit host secrets into sandbox commands", () => {
  const inherited = inheritedSandboxEnvironment({
    PATH: "/usr/bin",
    LANG: "zh_CN.UTF-8",
    GH_TOKEN: "secret",
    HELIOS_AI_KEY: "secret",
    HELIOS_EVE_PASSWORD: "secret"
  });

  assert.equal(inherited.PATH, "/usr/bin");
  assert.equal(inherited.LANG, "zh_CN.UTF-8");
  assert.equal(inherited.GH_TOKEN, undefined);
  assert.equal(inherited.HELIOS_AI_KEY, undefined);
  assert.equal(inherited.HELIOS_EVE_PASSWORD, undefined);
})
