import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

export const REQUIRED_NODE_MAJOR = 24
const DEVELOPMENT_EVE_PORT_BASE = 24722
const DEVELOPMENT_EVE_PORT_RANGE = 1000

export function parseNodeMajor(version) {
  const match = /^v?(\d+)(?:\.|$)/.exec(String(version).trim())
  return match ? Number(match[1]) : null
}

export function resolveDevelopmentEvePort({
  env = process.env,
  processId = process.pid
} = {}) {
  const explicit = env.HELIOS_EVE_PORT?.trim()
  if (explicit) {
    const port = Number(explicit)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`HELIOS_EVE_PORT 必须是 1024 到 65535 之间的整数，当前值：${explicit}`)
    }
    return port
  }

  return DEVELOPMENT_EVE_PORT_BASE + (Math.abs(processId) % DEVELOPMENT_EVE_PORT_RANGE)
}

function executableName(platform) {
  return platform === 'win32' ? 'node.exe' : 'node'
}

export function inspectNode(executable) {
  if (executable !== 'node' && !existsSync(executable)) return null
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error || result.status !== 0) return null
  const version = String(result.stdout || result.stderr).trim()
  return { executable, version, major: parseNodeMajor(version) }
}

export function selectCompatibleNode(candidates, inspect = inspectNode) {
  const seen = new Set()
  const inspected = []
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    const result = inspect(candidate)
    if (!result) continue
    inspected.push(result)
    if (result.major === REQUIRED_NODE_MAJOR) return { selected: result, inspected }
  }
  return { selected: null, inspected }
}

function pathNodes(env, platform) {
  const name = executableName(platform)
  return String(env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name))
}

export function developmentNodeCandidates({
  repoRoot,
  env = process.env,
  platform = process.platform,
  currentExecutable = process.execPath
}) {
  const explicit = env.HELIOS_NODE_PATH?.trim()
  const releaseNode =
    platform === 'win32'
      ? join(
          repoRoot,
          'apps',
          'desktop',
          'build',
          'windows',
          'x64',
          'runner',
          'Release',
          'helios',
          'node',
          'node.exe'
        )
      : join(
          repoRoot,
          'apps',
          'desktop',
          'build',
          'macos',
          'Build',
          'Products',
          'Release',
          'Sealos.app',
          'Contents',
          'Resources',
          'helios',
          'node',
          'bin',
          'node'
        )
  return [explicit, currentExecutable, releaseNode, ...pathNodes(env, platform)].filter(Boolean)
}

export function resolveDevelopmentNode(options) {
  const candidates = developmentNodeCandidates(options)
  const { selected, inspected } = selectCompatibleNode(candidates)
  if (selected) return selected

  const detected = inspected.length
    ? inspected.map(({ executable, version }) => `${version} (${resolve(executable)})`).join(', ')
    : '未找到可执行的 Node.js'
  throw new Error(
    `Helios 桌面后端需要 Node ${REQUIRED_NODE_MAJOR}.x；检测结果：${detected}。` +
      `请安装 Node ${REQUIRED_NODE_MAJOR}，或设置 HELIOS_NODE_PATH 指向 Node ${REQUIRED_NODE_MAJOR} 可执行文件。`
  )
}
