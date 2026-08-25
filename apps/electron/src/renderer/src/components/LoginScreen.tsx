import { useEffect, useRef, useState } from 'react'
import type { LoginEvent, RegionOption, SealosStatus } from '../../../shared/types'
import logo from '../assets/logo.svg'

interface Props {
  onAuthenticated: (status: SealosStatus) => void
}

type Phase = 'idle' | 'authorizing' | 'exchanging'

function LoginScreen({ onAuthenticated }: Props): React.JSX.Element {
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [region, setRegion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [device, setDevice] = useState<{ url: string; code: string } | null>(null)
  const [error, setError] = useState('')
  const [kubeconfigText, setKubeconfigText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const onAuthRef = useRef(onAuthenticated)

  useEffect(() => {
    onAuthRef.current = onAuthenticated
  }, [onAuthenticated])

  useEffect(() => {
    void window.helios.getRegions().then((list) => {
      setRegions(list)
      setRegion((current) => current || list[0]?.url || '')
    })
    const unsubscribe = window.helios.onLoginEvent((event: LoginEvent) => {
      switch (event.type) {
        case 'device_code':
          setDevice({ url: event.verificationUrl, code: event.userCode })
          setPhase('authorizing')
          break
        case 'exchanging':
          setPhase('exchanging')
          break
        case 'success':
          onAuthRef.current(event.status)
          break
        case 'error':
          setError(event.message)
          setPhase('idle')
          setDevice(null)
          break
      }
    })
    return () => {
      unsubscribe()
      void window.helios.cancelLogin()
    }
  }, [])

  const startLogin = (): void => {
    setError('')
    setDevice(null)
    setPhase('authorizing')
    void window.helios.startLogin(region)
  }

  const cancel = (): void => {
    void window.helios.cancelLogin()
    setPhase('idle')
    setDevice(null)
  }

  const submitKubeconfig = async (): Promise<void> => {
    setError('')
    try {
      const status = await window.helios.saveKubeconfig(kubeconfigText)
      onAuthRef.current(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        <img className="login-logo" src={logo} alt="" />
        <h1>Helios</h1>
        <p>让 Sealos 更好用的桌面操作台。</p>
      </div>

      <div className="login-panel">
        {phase === 'idle' && (
          <>
            <label className="field-label" htmlFor="region">
              区域
            </label>
            <select
              id="region"
              className="field"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r.url} value={r.url}>
                  {r.label}
                </option>
              ))}
            </select>

            <button className="btn btn-primary" onClick={startLogin}>
              使用 Sealos 账号登录
            </button>

            <div className="divider">
              <span>或</span>
            </div>

            {showPaste ? (
              <>
                <textarea
                  className="field field-textarea"
                  placeholder="粘贴 Sealos 控制台导出的 kubeconfig（头像 → kubeconfig）"
                  value={kubeconfigText}
                  onChange={(e) => setKubeconfigText(e.target.value)}
                  spellCheck={false}
                />
                <button
                  className="btn"
                  disabled={!kubeconfigText.trim()}
                  onClick={() => void submitKubeconfig()}
                >
                  保存 kubeconfig
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setShowPaste(true)}>
                粘贴 kubeconfig 登录
              </button>
            )}
          </>
        )}

        {phase !== 'idle' && (
          <div className="login-progress">
            {device ? (
              <>
                <p>已在浏览器打开授权页面，确认登录即可。</p>
                <div className="user-code">{device.code}</div>
                <p className="hint">
                  没有自动打开？
                  <a
                    href="#open"
                    onClick={(e) => {
                      e.preventDefault()
                      void window.helios.openExternal(device.url)
                    }}
                  >
                    点这里重新打开
                  </a>
                </p>
              </>
            ) : (
              <p>正在请求授权…</p>
            )}
            <p className="hint">
              {phase === 'exchanging' ? '授权成功，正在获取工作空间…' : '等待浏览器授权…'}
            </p>
            <button className="btn btn-ghost" onClick={cancel}>
              取消
            </button>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

export default LoginScreen
