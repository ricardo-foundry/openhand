import { useState } from 'react'
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Loader2, 
  MoreHorizontal,
  Play,
  Pause,
  RotateCcw
} from 'lucide-react'

interface Task {
  id: string
  type: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  result?: string
}

const mockTasks: Task[] = [
  {
    id: 'task-1',
    type: 'file_read',
    description: 'Read configuration file',
    status: 'completed',
    createdAt: '2024-01-15T10:30:00Z',
    result: 'Successfully read 245 bytes'
  },
  {
    id: 'task-2',
    type: 'shell_exec',
    description: 'List directory contents',
    status: 'running',
    createdAt: '2024-01-15T10:32:00Z'
  },
  {
    id: 'task-3',
    type: 'browser_search',
    description: 'Search for Node.js documentation',
    status: 'pending',
    createdAt: '2024-01-15T10:35:00Z'
  },
  {
    id: 'task-4',
    type: 'file_write',
    description: 'Write log file',
    status: 'failed',
    createdAt: '2024-01-15T10:28:00Z',
    result: 'Permission denied'
  }
]

export default function Tasks() {
  const [tasks] = useState<Task[]>(mockTasks)
  const [filter, setFilter] = useState<string>('all')

  const filteredTasks = filter === 'all' 
    ? tasks 
    : tasks.filter(t => t.status === filter)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />
      case 'running':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-600" />
      default:
        return <MoreHorizontal className="w-5 h-5 text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'running':
        return 'bg-blue-100 text-blue-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Tasks</h2>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            <RotateCcw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredTasks.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(task.status)}
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                      {task.status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{task.type}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{task.description}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(task.createdAt).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    {task.status === 'pending' && (
                      <button className="p-1 text-green-600 hover:bg-green-50 rounded">
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    {task.status === 'running' && (
                      <button className="p-1 text-yellow-600 hover:bg-yellow-50 rounded">
                        <Pause className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}