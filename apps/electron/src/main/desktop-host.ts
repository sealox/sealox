export interface DesktopHost {
  readonly isPackaged: boolean
  readonly appRoot: string
  readonly resourcesPath: string
  readonly userDataPath: string
  readonly downloadsPath: string
  readonly appVersion: string
  readonly platform: NodeJS.Platform
  emit(channel: string, payload: unknown): void
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<string>
  writeClipboard(text: string): Promise<void>
  selectFiles(): Promise<string[]>
}

let configuredHost: DesktopHost | undefined

export function configureDesktopHost(host: DesktopHost): void {
  configuredHost = host
}

export function desktopHost(): DesktopHost {
  if (!configuredHost) throw new Error('Desktop host has not been configured')
  return configuredHost
}
