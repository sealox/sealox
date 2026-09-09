#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDevelopmentEvePort, resolveDevelopmentNode } from './node-runtime.mjs'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const device =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null

if (!device) throw new Error('Helios desktop development supports macOS and Windows only')

const sidecarNode = resolveDevelopmentNode({ repoRoot })
const evePort = resolveDevelopmentEvePort()
console.log(`[dev] sidecar runtime ${sidecarNode.version}: ${sidecarNode.executable}`)
console.log(`[dev] isolated Agent port: ${evePort}`)

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Flutter's Process.start cannot resolve npm's internal node shim on
      // every shell. Always pass a verified Node 24 executable.
      HELIOS_NODE_PATH: sidecarNode.executable,
      // Keep a development Agent from terminating an installed Helios Agent.
      HELIOS_EVE_PORT: String(evePort)
    }
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const flutter =
  process.env.FLUTTER_BIN || (process.platform === 'win32' ? 'flutter.bat' : 'flutter')

run(npm, ['run', 'build:backend'], repoRoot)
run(flutter, ['run', '-d', device], desktopRoot)
