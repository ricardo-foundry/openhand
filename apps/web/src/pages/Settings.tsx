import { useState } from 'react'
import { 
  Key, 
  Server, 
  Shield, 
  Bell,
  Save,
  CheckCircle
} from 'lucide-react'

interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}

const providers = [
  { id: 'openai', name: 'OpenAI', models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'claude', name: 'Claude (Anthropic)', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
  { id: 'ollama', name: 'Ollama (Local)', models: ['llama2', 'mistral', 'codellama'] },
  { id: 'custom', name: 'Custom', models: [] }
]

export default function Settings() {
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: 'openai',
    model: 'gpt-4',
    apiKey: '',
    baseUrl: ''
  })
  const [saved, setSaved] = useState(false)

  const selectedProvider = providers.find(p => p.id === llmConfig.provider)

  const handleSave = () => {
    // Simulate save
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Settings</h2>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>

      {saved && (
        <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-green-100 text-green-700 rounded-lg">
          <CheckCircle className="w-5 h-5" />
          <span>Settings saved successfully!</span>
        </div>
      )}

      <div className="space-y-6">
        {/* LLM Configuration */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Key className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">LLM Configuration</h3>
              <p className="text-sm text-gray-500">Configure your AI model settings</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Provider
              </label>
              <select
                value={llmConfig.provider}
                onChange={(e) => setLlmConfig({ ...llmConfig, provider: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <select
                value={llmConfig.model}
                onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {selectedProvider?.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {selectedProvider?.models.length === 0 && (
                  <option value="">Enter custom model</option>
                )}
              </select>
            </div>

            {llmConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={llmConfig.apiKey}
                  onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Your API key is stored locally and never sent to our servers.
                </p>
              </div>
            )}

            {(llmConfig.provider === 'ollama' || llmConfig.provider === 'custom') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={llmConfig.baseUrl}
                  onChange={(e) => setLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
                  placeholder={llmConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Security Settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">Security Settings</h3>
              <p className="text-sm text-gray-500">Configure sandbox and approval settings</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="font-medium text-gray-800">Sandbox Mode</p>
                <p className="text-sm text-gray-500">Run all operations in isolated environment</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="font-medium text-gray-800">Require Approval</p>
                <p className="text-sm text-gray-500">Ask for confirmation before destructive operations</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-800">Execution Timeout</p>
                <p className="text-sm text-gray-500">Maximum time for operations (seconds)</p>
              </div>
              <input
                type="number"
                defaultValue={30}
                className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-center"
              />
            </div>
          </div>
        </div>

        {/* Server Settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Server className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">Server Settings</h3>
              <p className="text-sm text-gray-500">Configure server connection</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Server URL
              </label>
              <input
                type="text"
                defaultValue="http://localhost:3001"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}