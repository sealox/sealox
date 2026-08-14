import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { Readable } from "node:stream";
import { mkdir, readFile, lstat, readlink, rm, symlink, writeFile } from "node:fs/promises";
import type {
  SandboxBackend,
  SandboxBackendHandle,
  SandboxProcess,
  SandboxSession
} from "eve/sandbox";

const WORKSPACE = "/workspace";
const HELIOS_ROOT = join(homedir(), ".helios");
const WORKSPACE_ROOT = join(HELIOS_ROOT, "workspace");
const SANDBOX_HOME = join(HELIOS_ROOT, "home");
const REAL_SEALOS = join(homedir(), ".sealos");
const KUBECONFIG = process.env["SEALOS_KUBECONFIG"] ?? join(REAL_SEALOS, "kubeconfig");

function hostPath(sandboxPath: string): string {
  if (sandboxPath === WORKSPACE || sandboxPath.startsWith(`${WORKSPACE}/`)) {
    return join(WORKSPACE_ROOT, sandboxPath.slice(WORKSPACE.length));
  }
  if (sandboxPath.startsWith("/")) return sandboxPath;
  return join(WORKSPACE_ROOT, sandboxPath);
}

function commandEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const path = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".docker/bin"),
    process.env["PATH"] ?? "/usr/bin:/bin"
  ].join(":");
  return {
    ...process.env,
    HOME: SANDBOX_HOME,
    KUBECONFIG,
    SEALOS_KUBECONFIG: KUBECONFIG,
    PATH: path,
    ...extra
  };
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
  await symlink(REAL_SEALOS, link);
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
    const cwd = options.workingDirectory ? hostPath(options.workingDirectory) : WORKSPACE_ROOT;
    const proc = spawn("/bin/bash", ["-c", options.command], {
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
