import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  RotateCcw,
  Play,
} from 'lucide-react'

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

interface TaskStreamEvent {
  id: number
  taskId: string
  timestamp: number
  status: TaskStatus
  message?: string
  data?: unknown
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export default function Tasks() {
  const [taskId, setTaskId] = useState<string>('demo-1')
  const [events, setEvents] = useState<TaskStreamEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const logBottomRef = useRef<HTMLDivElement>(null)

  // Open an EventSource whenever `taskId` changes.
  useEffect(() => {
    // Close any previous stream.
    sourceRef.current?.close()
    setEvents([])
    setError(null)
    setConnected(false)

    if (!taskId) return

    const url = `${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/stream`
    const es = new EventSource(url)
    sourceRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => {
      setConnected(false)
      setError('stream disconnected; retrying...')
    }
    es.addEventListener('task', (msg: MessageEvent) => {
      try {
        const evt = JSON.parse(msg.data) as TaskStreamEvent
        setEvents(prev => [...prev, evt])
      } catch {
        /* ignore bad frames */
      }
    })

    return () => {
      es.close()
      sourceRef.current = null
    }
  }, [taskId])

  // Auto-scroll to the bottom of the log as new events arrive.
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const currentStatus: TaskStatus =
    events.length > 0 ? events[events.length - 1]!.status : 'pending'

  async function triggerDemo(): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/_demo`, {
        method: 'POST',
      })
    } catch (err) {
      setError(`demo failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Tasks</h2>
          <p className="text-sm text-gray-500">
            Live stream from <code className="px-1 bg-gray-100 rounded">GET /api/tasks/&lt;id&gt;/stream</code>
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={taskId}
            onChange={e => setTaskId(e.target.value)}
            placeholder="task id"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={triggerDemo}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Play className="w-4 h-4" /> Run demo
          </button>
          <button
            onClick={() => setTaskId(taskId)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            <RotateCcw className="w-4 h-4" /> Reconnect
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <StatusPill status={currentStatus} />
        <span className="text-sm text-gray-500">
          {connected ? 'connected' : 'disconnected'} · {events.length} events
        </span>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="h-96 overflow-y-auto p-4 font-mono text-sm space-y-1 bg-gray-50">
          {events.length === 0 && (
            <div className="text-gray-400">
              No events yet. Click "Run demo" or publish events to task id "{taskId}".
            </div>
          )}
          {events.map(evt => (
            <div key={`${evt.taskId}-${evt.id}`} className="flex gap-2">
              <span className="text-gray-400 select-none">
                {new Date(evt.timestamp).toLocaleTimeString()}
              </span>
              <StatusDot status={evt.status} />
              <span className="text-gray-800">{evt.message ?? '(no message)'}</span>
            </div>
          ))}
          <div ref={logBottomRef} />
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: TaskStatus }) {
  const cls =
    status === 'completed'
      ? 'bg-green-100 text-green-800'
      : status === 'failed'
      ? 'bg-red-100 text-red-800'
      : status === 'running'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-yellow-100 text-yellow-800'
  const Icon =
    status === 'completed' ? CheckCircle :
    status === 'failed' ? XCircle :
    status === 'running' ? Loader2 : Clock
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${cls}`}>
      <Icon className={`w-4 h-4 ${status === 'running' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  )
}

function StatusDot({ status }: { status: TaskStatus }) {
  const cls =
    status === 'completed'
      ? 'bg-green-500'
      : status === 'failed'
      ? 'bg-red-500'
      : status === 'running'
      ? 'bg-blue-500'
      : 'bg-yellow-500'
  return <span className={`inline-block w-2 h-2 mt-2 rounded-full ${cls}`} aria-hidden />
}
