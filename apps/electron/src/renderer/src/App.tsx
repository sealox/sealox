import { useCallback, useEffect, useState } from 'react'
import type { SealosStatus } from '../../shared/types'
import LoginScreen from './components/LoginScreen'
import ResourcesScreen from './components/ResourcesScreen'
import logo from './assets/logo.svg'

function App(): React.JSX.Element {
  const [status, setStatus] = useState<SealosStatus | null>(null)

  const refreshStatus = useCallback(() => {
    window.helios.getStatus().then(setStatus, console.error)
  }, [])

  useEffect(() => {
    const timer = setTimeout(refreshStatus, 0)
    return () => clearTimeout(timer)
  }, [refreshStatus])

  if (status === null) {
    return (
      <div className="app-loading">
        <img className="loading-logo" src={logo} alt="" />
      </div>
    )
  }

  if (!status.authenticated) {
    return <LoginScreen onAuthenticated={setStatus} />
  }

  return (
    <ResourcesScreen
      status={status}
      onStatusChange={setStatus}
      onLogout={async () => {
        await window.helios.logout()
        refreshStatus()
      }}
    />
  )
}

export default App
