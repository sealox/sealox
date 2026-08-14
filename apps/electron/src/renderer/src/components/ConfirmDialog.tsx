import { useEffect } from 'react'

interface Props {
  title: string
  children: React.ReactNode
  error?: string
  busy?: boolean
  cancelLabel?: string
  extraLabel?: string
  confirmLabel: string
  onCancel: () => void
  onExtra?: () => void
  onConfirm: () => void
}

function ConfirmDialog({
  title,
  children,
  error,
  busy = false,
  cancelLabel = '取消',
  extraLabel,
  confirmLabel,
  onCancel,
  onExtra,
  onConfirm
}: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div
      className="confirm-overlay"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        {error && <div className="error">{error}</div>}
        <div className="confirm-actions">
          <button className="btn-neutral" type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          {extraLabel && onExtra && (
            <button className="btn-neutral" type="button" disabled={busy} onClick={onExtra}>
              {extraLabel}
            </button>
          )}
          <button
            className="daction daction-danger"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
