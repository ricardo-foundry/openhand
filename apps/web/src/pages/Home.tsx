import { 
  MessageSquare, 
  FileText, 
  Globe, 
  Mail,
  Shield,
  Zap,
  Clock,
  CheckCircle
} from 'lucide-react'

const features = [
  {
    icon: Shield,
    title: 'Secure Sandbox',
    description: 'All operations run in isolated environments',
    color: 'bg-green-100 text-green-700'
  },
  {
    icon: Zap,
    title: 'Multi-LLM Support',
    description: 'Works with OpenAI, Claude, Ollama and more',
    color: 'bg-yellow-100 text-yellow-700'
  },
  {
    icon: Clock,
    title: 'Task Management',
    description: 'Track and manage all your AI tasks',
    color: 'bg-blue-100 text-blue-700'
  },
  {
    icon: CheckCircle,
    title: 'Approval Workflow',
    description: 'Review sensitive operations before execution',
    color: 'bg-purple-100 text-purple-700'
  }
]

const quickActions = [
  { icon: MessageSquare, label: 'Start Chat', path: '/chat', color: 'bg-primary-600' },
  { icon: FileText, label: 'Read File', action: 'read', color: 'bg-orange-500' },
  { icon: Globe, label: 'Web Search', action: 'search', color: 'bg-green-500' },
  { icon: Mail, label: 'Check Email', action: 'email', color: 'bg-red-500' },
]

export default function Home() {
  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-2xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-3">Welcome to OpenHand</h1>
        <p className="text-primary-100 text-lg mb-6 max-w-2xl">
          Your secure AI assistant for file management, web search, email handling, and more. 
          All operations run in a sandboxed environment for maximum safety.
        </p>
        <div className="flex gap-4">
          <a 
            href="/chat" 
            className="px-6 py-3 bg-white text-primary-700 font-semibold rounded-lg hover:bg-primary-50 transition-colors"
          >
            Start Chatting
          </a>
          <a 
            href="/settings" 
            className="px-6 py-3 bg-primary-700 text-white font-semibold rounded-lg hover:bg-primary-600 transition-colors"
          >
            Configure
          </a>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <a
              key={action.label}
              href={action.path || '#'}
              className="flex flex-col items-center p-6 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-md transition-all"
            >
              <div className={`w-12 h-12 ${action.color} rounded-xl flex items-center justify-center mb-3`}>
                <action.icon className="w-6 h-6 text-white" />
              </div>
              <span className="font-medium text-gray-700">{action.label}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Features */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Key Features</h2>
        <div className="grid grid-cols-2 gap-4">
          {features.map((feature) => (
            <div 
              key={feature.title}
              className="flex items-start gap-4 p-5 bg-white rounded-xl border border-gray-200"
            >
              <div className={`w-10 h-10 ${feature.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <feature.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">{feature.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">System Status</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">●</div>
            <div className="text-sm text-gray-600 mt-1">API Server</div>
            <div className="text-xs text-green-600">Online</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">●</div>
            <div className="text-sm text-gray-600 mt-1">Sandbox</div>
            <div className="text-xs text-green-600">Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-400">●</div>
            <div className="text-sm text-gray-600 mt-1">LLM</div>
            <div className="text-xs text-gray-500">Not Configured</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">●</div>
            <div className="text-sm text-gray-600 mt-1">WebSocket</div>
            <div className="text-xs text-green-600">Connected</div>
          </div>
        </div>
      </div>
    </div>
  )
}