import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join, posix } from "node:path";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, lstat, readlink, rm, symlink, writeFile } from "node:fs/promises";
import type {
  SandboxBackend,
  SandboxBackendHandle,
  SandboxProcess,
  SandboxSession
} from "eve/sandbox";
import { assertSafeSandboxCommand, inheritedSandboxEnvironment } from "./security";

const WORKSPACE = "/workspace";
const HELIOS_ROOT = join(homedir(), ".helios");
const WORKSPACE_ROOT = join(HELIOS_ROOT, "workspace");
const SANDBOX_HOME = join(HELIOS_ROOT, "home");
const SANDBOX_CONFIG = join(SANDBOX_HOME, ".config");
const GH_CONFIG_DIR = join(SANDBOX_CONFIG, "gh");
const DOCKER_CONFIG = join(SANDBOX_HOME, ".docker");
const DOCKER_CONFIG_PATH = join(DOCKER_CONFIG, "config.json");
const SANDBOX_GITCONFIG = join(SANDBOX_HOME, ".gitconfig");
const REAL_SEALOS = join(homedir(), ".sealos");
const KUBECONFIG = process.env["SEALOS_KUBECONFIG"] ?? join(REAL_SEALOS, "kubeconfig");

function hostPath(sandboxPath: string): string {
  if (sandboxPath === WORKSPACE || sandboxPath.startsWith(`${WORKSPACE}/`)) {
    return join(WORKSPACE_ROOT, sandboxPath.slice(WORKSPACE.length));
  }
  if (sandboxPath.startsWith("/")) {
    return process.platform === "win32"
      ? join(SANDBOX_HOME, "rootfs", sandboxPath.slice(1))
      : sandboxPath;
  }
  return join(WORKSPACE_ROOT, sandboxPath);
}

function commandEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const platformPaths = process.platform === "win32"
    ? [
        dirname(bashExecutable()),
        join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin"),
        process.env["PATH"] ?? ""
      ]
    : [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join(homedir(), ".docker/bin"),
        process.env["PATH"] ?? "/usr/bin:/bin"
      ];
  return {
    ...inheritedSandboxEnvironment(process.env),
    HOME: SANDBOX_HOME,
    USERPROFILE: SANDBOX_HOME,
    XDG_CONFIG_HOME: SANDBOX_CONFIG,
    GH_CONFIG_DIR,
    DOCKER_CONFIG,
    // Keep git from inheriting a host-level credential helper through an
    // explicitly configured GIT_CONFIG_GLOBAL path.
    GIT_CONFIG_GLOBAL: SANDBOX_GITCONFIG,
    KUBECONFIG,
    SEALOS_KUBECONFIG: KUBECONFIG,
    PATH: platformPaths.filter(Boolean).join(delimiter),
    ...extra
  };
}

function bashExecutable(): string {
  if (process.env["HELIOS_BASH_PATH"]) return process.env["HELIOS_BASH_PATH"];
  if (process.platform !== "win32") return "/bin/bash";
  const candidates = [
    join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    join(process.env["LOCALAPPDATA"] ?? homedir(), "Programs", "Git", "bin", "bash.exe")
  ];
  return candidates.find(existsSync) ?? "bash.exe";
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function nodeToWeb(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> {
  if (!stream) {
    return new ReadableStream({
      start(controller) {
        controller.close();
      }
    });
  }
  return Readable.toWeb(Readable.from(stream)) as ReadableStream<Uint8Array>;
}

async function ensureLayout(): Promise<void> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  await mkdir(SANDBOX_HOME, { recursive: true });
  await mkdir(GH_CONFIG_DIR, { recursive: true });
  await ensureGitConfig();
  await ensureDockerConfig();
  const link = join(SANDBOX_HOME, ".sealos");
  try {
    const st = await lstat(link);
    if (st.isSymbolicLink()) {
      if ((await readlink(link)) === REAL_SEALOS) return;
      await rm(link);
    } else {
      return;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await symlink(REAL_SEALOS, link, process.platform === "win32" ? "junction" : "dir");
}

/** Remove credential helpers from the sandbox-only git config. */
async function ensureGitConfig(): Promise<void> {
  let source = "";
  try {
    source = await readFile(SANDBOX_GITCONFIG, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") source = "";
  }

  const lines = source.split(/\r?\n/);
  let section = "";
  const sanitized = lines.filter((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      return true;
    }
    return !(section === "credential" && /^\s*helper\s*=/.test(line));
  });
  const output = sanitized.join("\n");
  if (output !== source) {
    await writeFile(SANDBOX_GITCONFIG, output, { encoding: "utf8", mode: 0o600 });
  }
  try {
    await chmod(SANDBOX_GITCONFIG, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Docker Desktop's credential helpers talk to the macOS Keychain. Agent
 * commands run with a synthetic HOME, so a helper configured by the host can
 * only fail or open a Keychain dialog. Keep the sandbox config file-backed.
 */
async function ensureDockerConfig(): Promise<void> {
  await mkdir(DOCKER_CONFIG, { recursive: true });

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(DOCKER_CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // A broken sandbox config must not prevent the agent from starting. It
      // will be replaced with a minimal file-backed config below.
      config = {};
    }
  }

  const auths = config["auths"];
  if (!auths || typeof auths !== "object" || Array.isArray(auths)) {
    config["auths"] = {};
  }
  delete config["credsStore"];
  delete config["credHelpers"];

  await writeFile(DOCKER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(DOCKER_CONFIG_PATH, 0o600);
}

function createSession(id: string): SandboxSession {
  async function spawnCommand(options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<SandboxProcess> {
    if (options.abortSignal?.aborted) {
      throw options.abortSignal.reason instanceof Error
        ? options.abortSignal.reason
        : new Error("aborted");
    }
    assertSafeSandboxCommand(options.command);
    const cwd = options.workingDirectory ? hostPath(options.workingDirectory) : WORKSPACE_ROOT;
    const proc = spawn(bashExecutable(), ["-c", options.command], {
      cwd,
      env: commandEnv(options.env),
      signal: options.abortSignal,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let exitCode = 0;
    const finished = new Promise<{ exitCode: number }>((resolve, reject) => {
      proc.once("error", reject);
      proc.once("close", (code, signal) => {
        if (code === null) {
          exitCode = signal ? 1 : 0;
        } else {
          exitCode = code;
        }
        resolve({ exitCode });
      });
    });
    return {
      pid: proc.pid,
      stdout: nodeToWeb(proc.stdout),
      stderr: nodeToWeb(proc.stderr),
      wait: () => finished,
      async kill() {
        if (proc.killed || proc.exitCode !== null) return;
        proc.kill("SIGTERM");
      }
    };
  }

  return {
    id,
    resolvePath(path) {
      if (path.startsWith("/")) return posix.normalize(path);
      return posix.join(WORKSPACE, path);
    },
    async run(options) {
      const child = await spawnCommand(options);
      const [stdout, stderr, { exitCode }] = await Promise.all([
        streamToBuffer(child.stdout).then((buf) => buf.toString("utf8")),
        streamToBuffer(child.stderr).then((buf) => buf.toString("utf8")),
        child.wait()
      ]);
      return { exitCode, stdout, stderr };
    },
    spawn: spawnCommand,
    async readFile(options) {
      try {
        const buf = await readFile(hostPath(options.path));
        return Readable.toWeb(Readable.from(buf)) as ReadableStream<Uint8Array>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async readBinaryFile(options) {
      try {
        const buf = await readFile(hostPath(options.path));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async readTextFile(options) {
      let text: string;
      try {
        text = await readFile(hostPath(options.path), {
          encoding: (options.encoding as BufferEncoding | undefined) ?? "utf8"
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      if (options.startLine === undefined && options.endLine === undefined) return text;
      const lines = text.split(/(?<=\n)/);
      const start = (options.startLine ?? 1) - 1;
      const end = options.endLine ?? lines.length;
      if (start >= lines.length) return "";
      return lines.slice(Math.max(0, start), end).join("");
    },
    async writeFile(options) {
      const target = hostPath(options.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await streamToBuffer(options.content));
    },
    async writeBinaryFile(options) {
      const target = hostPath(options.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, options.content);
    },
    async writeTextFile(options) {
      const target = hostPath(options.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, options.content, {
        encoding: (options.encoding as BufferEncoding | undefined) ?? "utf8"
      });
    },
    async removePath(options) {
      await rm(hostPath(options.path), {
        force: options.force,
        recursive: options.recursive
      });
    },
    async setNetworkPolicy() {
      // Host process has the user's normal network; no firewall to apply.
    }
  };
}

function handleFor(id: string): SandboxBackendHandle {
  const session = createSession(id);
  return {
    session,
    useSessionFn: async () => session,
    async captureState() {
      return {
        backendName: "helios-host",
        metadata: { workspaceRoot: WORKSPACE_ROOT, sandboxHome: SANDBOX_HOME },
        sessionKey: id
      };
    },
    async stop() {},
    async shutdown() {}
  };
}

/** Real machine bash/fs so use-sealos can see ~/.sealos, kubectl, python3, docker. */
export function hostSandbox(): SandboxBackend {
  return {
    name: "helios-host",
    async prewarm() {
      await ensureLayout();
      return { reused: true };
    },
    async create(input) {
      await ensureLayout();
      return handleFor(input.sessionKey);
    }
  };
}
