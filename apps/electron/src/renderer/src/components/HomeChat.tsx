import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type {
  AgentStatus,
  ChatActivity,
  ChatConversation,
  ChatEvent,
  ChatInputResponse,
  ChatListItem,
  ChatMessage,
  ChatQuestion
} from '../../../shared/types'

interface Props {
  workspaceId: string
  insetLeft: number
}

const PROMPT_SUGGESTIONS: Array<{ label: string; icon: React.JSX.Element }> = [
  { label: 'n8n', icon: <WorkflowIcon size={16} /> },
  { label: 'WordPress', icon: <GlobeIcon size={16} /> },
  { label: 'Uptime Kuma', icon: <PulseIcon size={16} /> },
  { label: 'Halo', icon: <PenIcon size={16} /> },
  { label: 'MinIO', icon: <BucketIcon size={16} /> }
]

interface IconProps {
  size?: number
}

function iconAttrs(size = 20): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

function HistoryIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

function PlusIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ArrowUpIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 19V5m-7 7 7-7 7 7" />
    </svg>
  )
}

function StopIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TrashIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" />
    </svg>
  )
}

function CopyIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 16V5h11" />
    </svg>
  )
}

function WorkflowIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M8.2 6h7.6M7 8l4 8M17 8l-4 8" />
    </svg>
  )
}

function GlobeIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.8 2.7 2.8 13.3 0 16-2.8-2.7-2.8-13.3 0-16Z" />
    </svg>
  )
}

function PulseIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M3.5 12h4L10 6l4 12 2.5-6h4" />
    </svg>
  )
}

function PenIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <path d="m5 19 1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L9 18l-4 1Z" />
    </svg>
  )
}

function BucketIcon({ size }: IconProps): React.JSX.Element {
  return (
    <svg {...iconAttrs(size)}>
      <ellipse cx="12" cy="6" rx="7" ry="2.2" />
      <path d="M5 6l1.6 12.2A2 2 0 0 0 8.6 20h6.8a2 2 0 0 0 2-1.8L19 6" />
    </svg>
  )
}

function upsertActivity(list: ChatActivity[] | undefined, item: ChatActivity): ChatActivity[] {
  const next = [...(list ?? [])]
  const index = next.findIndex((row) => row.id === item.id)
  if (index >= 0) next[index] = item
  else next.push(item)
  return next
}

function patchAssistant(
  conversation: ChatConversation,
  patch: Partial<ChatMessage>
): ChatConversation {
  const messages = [...conversation.messages]
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'assistant') continue
    messages[i] = { ...messages[i], ...patch }
    return { ...conversation, messages }
  }
  return conversation
}

function AssistantMarkdown({ text }: { text: string }): React.JSX.Element | null {
  if (!text) return null
  return (
    <div className="chat-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  if (href && /^https?:\/\//.test(href)) void window.helios.openExternal(href)
                }}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function liveSummary(msg: ChatMessage): string {
  const running = msg.activities?.find((item) => item.status === 'running')
  if (running) return running.detail ? `${running.label} · ${running.detail}` : running.label
  if (msg.reasoning) return '思考中…'
  return '正在思考…'
}

function Trace({ msg }: { msg: ChatMessage }): React.JSX.Element | null {
  const hasReasoning = Boolean(msg.reasoning)
  const hasActivities = Boolean(msg.activities && msg.activities.length > 0)
  if (!hasReasoning && !hasActivities) return null
  return (
    <details
      className="chat-trace"
      key={msg.pending ? 'live' : 'done'}
      ref={(el) => {
        if (el && msg.pending) el.open = true
      }}
    >
      <summary>{msg.pending ? liveSummary(msg) : '思考过程'}</summary>
      {msg.reasoning ? <div className="chat-trace-reason">{msg.reasoning}</div> : null}
      {msg.activities && msg.activities.length > 0 ? (
        <ul className="chat-activity">
          {msg.activities.map((item) => (
            <li key={item.id} className={item.status}>
              <span className="chat-activity-mark" aria-hidden />
              <span className="chat-activity-label">{item.label}</span>
              {item.detail ? <span className="chat-activity-detail">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  )
}

function QuestionCard({
  question,
  disabled,
  onRespond
}: {
  question: ChatQuestion
  disabled: boolean
  onRespond: (response: ChatInputResponse) => void
}): React.JSX.Element {
  const [freeform, setFreeform] = useState('')
  const showFreeform = question.allowFreeform || !question.options?.length
  return (
    <div className="chat-question">
      <p>{question.prompt}</p>
      {question.options && question.options.length > 0 ? (
        <div className="chat-question-opts">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onRespond({ requestId: question.requestId, optionId: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {showFreeform ? (
        <form
          className="chat-question-freeform"
          onSubmit={(event) => {
            event.preventDefault()
            const text = freeform.trim()
            if (!text || disabled) return
            onRespond({ requestId: question.requestId, text })
          }}
        >
          <input
            value={freeform}
            disabled={disabled}
            placeholder="输入回复…"
            onChange={(event) => setFreeform(event.target.value)}
          />
          <button type="submit" disabled={disabled || !freeform.trim()}>
            发送
          </button>
        </form>
      ) : null}
    </div>
  )
}

export default function HomeChat({ workspaceId, insetLeft }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [list, setList] = useState<ChatListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ChatConversation | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [agent, setAgent] = useState<AgentStatus>({ state: 'stopped' })
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const messages = conversation?.messages ?? []
  const questions = conversation?.questions ?? []
  const chatting = messages.length > 0
  const last = messages[messages.length - 1]
  const generating = Boolean(last?.role === 'assistant' && last.pending)
  const waitingOnQuestion = questions.length > 0

  useEffect(() => {
    if (!workspaceId) return
    void window.helios.listChats().then(setList, () => setList([]))
  }, [workspaceId])

  useEffect(() => {
    void window.helios.getAgentStatus().then(setAgent)
    return window.helios.onAgentStatus(setAgent)
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    void window.helios.getChat(selectedId).then((chat) => {
      if (cancelled || !chat) return
      setConversation(chat)
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    return window.helios.onChatEvent((event: ChatEvent) => {
      if (event.type === 'index') {
        if (event.workspaceId === workspaceId) setList(event.items)
        return
      }
      if (event.type === 'deleted') {
        if (event.conversationId === selectedId) {
          setSelectedId(null)
          setConversation(null)
          setBusy(false)
        }
        return
      }
      const conversationId =
        event.type === 'snapshot' ? event.conversation.id : event.conversationId
      if (conversationId !== selectedId) return
      if (event.type === 'snapshot') {
        setConversation(event.conversation)
        setBusy(Boolean(event.conversation.messages.at(-1)?.pending))
        return
      }
      if (event.type === 'waiting' || event.type === 'done' || event.type === 'cancelled') {
        setBusy(false)
        setConversation((prev) => (prev ? patchAssistant(prev, { pending: false }) : prev))
        return
      }
      if (event.type === 'error') {
        setBusy(false)
        setConversation((prev) =>
          prev ? patchAssistant(prev, { pending: false, error: event.message }) : prev
        )
        return
      }
      if (event.type === 'question') {
        setConversation((prev) => (prev ? { ...prev, questions: event.questions } : prev))
        return
      }
      setConversation((prev) => {
        if (!prev) return prev
        if (event.type === 'delta') {
          return patchAssistant(prev, { text: event.text, pending: true, error: undefined })
        }
        if (event.type === 'reasoning') {
          return patchAssistant(prev, { reasoning: event.text, pending: true })
        }
        return patchAssistant(prev, {
          activities: upsertActivity(prev.messages.at(-1)?.activities, event.item),
          pending: true
        })
      })
    })
  }, [workspaceId, selectedId])

  useEffect(() => {
    if (!stickToBottom.current) return
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation])

  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  const startNewChat = useCallback(() => {
    setSelectedId(null)
    setConversation(null)
    setBusy(false)
    setDrawerOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const openChat = useCallback((id: string) => {
    stickToBottom.current = true
    setSelectedId(id)
    setDrawerOpen(false)
  }, [])

  const submit = useCallback(() => {
    const value = text.trim()
    if (!value || generating || waitingOnQuestion || busy || agent.state !== 'ready') return
    const id = selectedId ?? crypto.randomUUID()
    stickToBottom.current = true
    setSelectedId(id)
    setText('')
    setBusy(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
    })
    void window.helios.sendChatMessage(id, value).catch((err: unknown) => {
      setBusy(false)
      const message = err instanceof Error ? err.message : String(err)
      setConversation((prev) =>
        prev ? patchAssistant(prev, { pending: false, error: message }) : prev
      )
    })
  }, [text, generating, waitingOnQuestion, busy, agent.state, selectedId])

  const stop = useCallback(() => {
    if (!selectedId || !generating) return
    void window.helios.cancelChat(selectedId).catch(() => undefined)
  }, [selectedId, generating])

  const respond = useCallback(
    (response: ChatInputResponse) => {
      if (!selectedId || busy) return
      setBusy(true)
      void window.helios.respondChat(selectedId, [response]).catch((err: unknown) => {
        setBusy(false)
        const message = err instanceof Error ? err.message : String(err)
        setConversation((prev) =>
          prev ? patchAssistant(prev, { pending: false, error: message }) : prev
        )
      })
    },
    [selectedId, busy]
  )

  const canSend =
    Boolean(text.trim()) && !generating && !waitingOnQuestion && !busy && agent.state === 'ready'

  return (
    <div className={`hero${chatting ? ' has-chat' : ''}`}>
      <div className="chat-toolbar" style={{ left: insetLeft }}>
        <button
          className={`icon-btn${drawerOpen ? ' active' : ''}`}
          title="对话历史"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <HistoryIcon size={16} />
        </button>
      </div>

      {drawerOpen ? (
        <button
          type="button"
          className="chat-drawer-backdrop"
          aria-label="关闭对话历史"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
      <aside className={`chat-drawer${drawerOpen ? ' open' : ''}`} aria-hidden={!drawerOpen}>
        <div className="chat-drawer-head">
          <span>对话</span>
          <button type="button" className="chat-drawer-new" onClick={startNewChat}>
            <PlusIcon size={14} />
            新对话
          </button>
        </div>
        {list.length === 0 ? (
          <p className="chat-drawer-empty">还没有对话</p>
        ) : (
          <ul className="chat-drawer-list">
            {list.map((item) => (
              <li key={item.id} className={item.id === selectedId ? 'current' : undefined}>
                <button
                  type="button"
                  className="chat-drawer-item"
                  onClick={() => openChat(item.id)}
                >
                  {item.title}
                </button>
                <button
                  type="button"
                  className="icon-btn chat-drawer-delete"
                  title="删除"
                  onClick={() => void window.helios.deleteChat(item.id)}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="hero-spacer-top" />
      <div className="hero-main">
        {!chatting && <h1>今天想开发点什么？</h1>}
        {chatting && (
          <div
            className="chat-log"
            ref={logRef}
            onScroll={() => {
              const el = logRef.current
              if (!el) return
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-msg ${msg.role}${msg.error ? ' error' : ''}${msg.role === 'assistant' ? ' md' : ''}`}
              >
                {msg.role === 'assistant' ? <Trace msg={msg} /> : null}
                {msg.role === 'user' ? (
                  msg.text
                ) : msg.error ? (
                  msg.error
                ) : (
                  <AssistantMarkdown text={msg.text} />
                )}
                {msg.role === 'assistant' &&
                msg.pending &&
                !msg.text &&
                !msg.error &&
                !msg.activities?.length &&
                !msg.reasoning
                  ? '正在思考…'
                  : null}
                {msg.role === 'assistant' && !msg.pending && msg.text ? (
                  <button
                    type="button"
                    className="chat-copy"
                    title="复制原文"
                    onClick={() => void window.helios.copyText(msg.text)}
                  >
                    <CopyIcon size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            {questions.map((question) => (
              <QuestionCard
                key={question.requestId}
                question={question}
                disabled={busy}
                onRespond={respond}
              />
            ))}
          </div>
        )}
        <div className="prompt-card">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={chatting ? '继续说…' : '把项目文件夹拖进来，或粘贴 Git 仓库地址…'}
            onChange={(event) => {
              setText(event.target.value)
              autosize()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <div className="prompt-actions">
            <button className="icon-btn" title="添加项目文件夹">
              <PlusIcon size={16} />
            </button>
            {generating ? (
              <button className="send-btn ready stop" title="停止生成" onClick={stop}>
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className={`send-btn${canSend ? ' ready' : ''}`}
                title="发送"
                onClick={submit}
                disabled={!canSend}
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
        {agent.state !== 'ready' && (
          <div className={`prompt-notice${agent.state === 'error' ? ' error' : ''}`}>
            {agent.state === 'starting' || agent.state === 'stopped'
              ? (agent.detail ?? '正在启动 AI 服务…')
              : (agent.detail ?? 'AI 服务不可用')}
          </div>
        )}
        {!chatting && (
          <div className="chips">
            {PROMPT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.label}
                onClick={() => {
                  setText(`部署一个 ${suggestion.label}`)
                  textareaRef.current?.focus()
                }}
              >
                {suggestion.icon}
                {suggestion.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hero-spacer-bottom" />
    </div>
  )
}
