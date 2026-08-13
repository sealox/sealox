import { ElectronAPI } from '@electron-toolkit/preload'
import type { HeliosApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    helios: HeliosApi
  }
}
