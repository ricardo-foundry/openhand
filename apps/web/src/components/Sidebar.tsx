import { NavLink } from 'react-router-dom'
import { 
  Home, 
  MessageSquare, 
  CheckSquare, 
  Settings, 
  Shield, 
  Zap,
  Bot
} from 'lucide-react'

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xl text-gray-900">OpenHand</h1>
            <p className="text-xs text-gray-500">Secure AI Assistant</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Status */}
      <div className="p-4 border-t border-gray-200">
        <div className="bg-green-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-green-800">Secure Mode</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">Sandbox Active</span>
          </div>
        </div>
      </div>
    </aside>
  )
}