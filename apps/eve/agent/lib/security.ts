const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g;
const GITLAB_TOKEN = /\bglpat-[A-Za-z0-9_-]{20,}\b/g;
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{20,}\b/g;
const DOCKER_PASSWORD = /(\bdocker\s+login\b[^\r\n]*?(?:--password(?:=|\s+)|-p\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s|]+)/gi;
const PIPED_DOCKER_PASSWORD = /\b(echo|printf)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s|]+)(\s*\|\s*docker\s+login\b)/gi;
const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD))=(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/g;
const AUTHORIZATION_HEADER = /(Authorization:\s*(?:Bearer|Basic)\s+)([^"'\s]+)/gi;
const CREDENTIAL_URL = /(https?:\/\/[^:\s/@]+:)[^@\s/]+@/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(GITHUB_TOKEN, "[REDACTED]")
    .replace(GITLAB_TOKEN, "[REDACTED]")
    .replace(NPM_TOKEN, "[REDACTED]")
    .replace(DOCKER_PASSWORD, "$1[REDACTED]")
    .replace(PIPED_DOCKER_PASSWORD, '$1 "[REDACTED]"$2')
    .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")
    .replace(AUTHORIZATION_HEADER, "$1[REDACTED]")
    .replace(CREDENTIAL_URL, "$1[REDACTED]@");
}

const KNOWN_CREDENTIAL = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,})\b/i;
const DOCKER_PASSWORD_ARGUMENT = /\bdocker\s+login\b[^\r\n]*(?:--password(?:=|\s+)|-p\s+)/i;
const GH_TOKEN_COMMAND = /\bgh\s+auth\s+token\b/i;
const SAFE_GH_TOKEN_PIPE = /\bgh\s+auth\s+token\b\s*\|\s*docker\s+login\b[^\r\n;&|]*--password-stdin\b/i;

export function assertSafeSandboxCommand(command: string): void {
  if (KNOWN_CREDENTIAL.test(command)) {
    throw new Error("拒绝执行包含明文凭证的命令；请通过安全管道或凭证文件传递");
  }
  if (DOCKER_PASSWORD_ARGUMENT.test(command)) {
    throw new Error("docker login 不允许使用 -p/--password；请改用 --password-stdin");
  }
  if (GH_TOKEN_COMMAND.test(command) && !SAFE_GH_TOKEN_PIPE.test(command)) {
    throw new Error("gh auth token 只能直接管道传给 docker login --password-stdin");
  }
}

const SAFE_ENV_KEYS = [
  "CI",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR"
] as const;

const WINDOWS_ENV_KEYS = ["COMSPEC", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT", "WINDIR"] as const;

export function inheritedSandboxEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const keys = platform === "win32" ? [...SAFE_ENV_KEYS, ...WINDOWS_ENV_KEYS] : SAFE_ENV_KEYS;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

let consoleRedactionInstalled = false;

export function installConsoleRedaction(): void {
  if (consoleRedactionInstalled) return;
  consoleRedactionInstalled = true;
  for (const method of ["log", "info", "warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...values: unknown[]) => {
      original(...values.map((value) => typeof value === "string" ? redactSensitiveText(value) : value));
    };
  }
}
