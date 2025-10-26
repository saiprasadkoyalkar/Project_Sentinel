import { useState, useEffect } from 'react'
import otherBg from '../components/ui/other.png';
import { BarChart3, TrendingUp, CheckCircle, Play, RefreshCw, AlertTriangle, Target } from 'lucide-react'

interface ConfusionMatrix {
  truePositive: number
  falsePositive: number
  trueNegative: number
  falseNegative: number
}

interface TopFailure {
  case: string
  frequency: number
}

interface EvaluationSummary {
  id: string
  name: string
  description: string
  testCases: number
  passed: number
  failed: number
  accuracy: number
  confusionMatrix: ConfusionMatrix
  topFailures: TopFailure[]
  lastRun: string | null
  status: string
  additionalMetrics?: any
}

const Evals = () => {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    fetchEvaluations()
  }, [])

  const fetchEvaluations = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/evals', {
        headers: {
          'x-api-key': 'sentinel-api-key-dev'
        }
      })
      if (response.ok) {
        const data = await response.json()
        setEvaluations(data)
      }
    } catch (error) {
      console.error('Failed to fetch evaluations:', error)
    } finally {
      setLoading(false)
    }
  }

  const runEvaluations = async () => {
    try {
    setRunning(true)
      // Run all evaluations by calling each one individually
      await Promise.all([
        fetch('/api/evals/fraud_detection/run', { 
          method: 'POST',
          headers: { 'x-api-key': 'sentinel-api-key-dev' }
        }),
        fetch('/api/evals/agent_performance/run', { 
          method: 'POST',
          headers: { 'x-api-key': 'sentinel-api-key-dev' }
        }),
        fetch('/api/evals/knowledge_base/run', { 
          method: 'POST',
          headers: { 'x-api-key': 'sentinel-api-key-dev' }
        }),
        fetch('/api/evals/case_handling/run', { 
          method: 'POST',
          headers: { 'x-api-key': 'sentinel-api-key-dev' }
        })
      ])
      await fetchEvaluations()
    } catch (error) {
      console.error('Failed to run evaluations:', error)
    } finally {
      setRunning(false)
    }
  }

  const totalTests = evaluations.reduce((sum, evaluation) => sum + evaluation.testCases, 0)
  const totalPassed = evaluations.reduce((sum, evaluation) => sum + evaluation.passed, 0)
  const overallAccuracy = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0'
  const avgAccuracy = evaluations.length > 0 
    ? (evaluations.reduce((sum, evaluation) => sum + evaluation.accuracy, 0) / evaluations.length).toFixed(1)
    : '0'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div
      className="relative min-h-screen p-6"
      style={{
        backgroundImage: `url(${otherBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Overlay for readability */}
      <div className="absolute inset-0 bg-white/70 pointer-events-none z-0" />
      <div className="relative z-10">
      <div className="mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Performance Evaluations</h1>
            <p className="text-gray-600">Test and monitor AI agent performance with real data analysis</p>
          </div>
          <button
            onClick={runEvaluations}
            disabled={running}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            {running ? 'Running...' : 'Run All Evaluations'}
          </button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 gap-6 mb-8 sm:grid-cols-4">
        <div className="bg-white p-6 rounded-lg shadow flex items-center">
          <BarChart3 className="w-8 h-8 text-blue-600 mr-3" />
          <span className="font-medium text-gray-500">Total Tests:</span>
          <span className="font-bold text-gray-900 ml-2">{totalTests}</span>
        </div>
        <div className="bg-white p-6 rounded-lg shadow flex items-center">
          <TrendingUp className="w-8 h-8 text-green-600 mr-3" />
          <span className="font-medium text-gray-500">Overall Accuracy:</span>
          <span className="font-bold text-gray-900 ml-2">{overallAccuracy}%</span>
        </div>
        <div className="bg-white p-6 rounded-lg shadow flex items-center">
          <Target className="w-8 h-8 text-purple-600 mr-3" />
          <span className="font-medium text-gray-500">Avg Accuracy:</span>
          <span className="font-bold text-gray-900 ml-2">{avgAccuracy}%</span>
        </div>
        <div className="bg-white p-6 rounded-lg shadow flex items-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mr-3" />
          <span className="font-medium text-gray-500">Evaluations:</span>
          <span className="font-bold text-gray-900 ml-2">{evaluations.length}</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'details', label: 'Detailed Results', icon: Target },
              { id: 'failures', label: 'Top Failures', icon: AlertTriangle }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-6 py-3 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4 mr-2" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {evaluations.map((evaluation) => (
                <div key={evaluation.id} className="border border-gray-200 rounded-lg p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">{evaluation.name}</h3>
                      <p className="text-sm text-gray-600">{evaluation.description}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                        evaluation.status === 'completed' 
                          ? 'bg-green-100 text-green-800'
                          : evaluation.status === 'running'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {evaluation.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 items-center mb-4 text-base">
                      <div className="mb-1"><span className="font-medium text-gray-700">Test Cases:</span> <span className="font-bold text-gray-900">{evaluation.testCases}</span></div>
                      <div className="mb-1"><span className="font-medium text-gray-700">Passed:</span> <span className="font-bold text-green-600">{evaluation.passed}</span></div>
                      <div className="mb-1"><span className="font-medium text-gray-700">Failed:</span> <span className="font-bold text-red-600">{evaluation.failed}</span></div>
                      <div><span className="font-medium text-gray-700">Accuracy:</span> <span className="font-bold text-blue-600">{evaluation.accuracy}%</span></div>
                    </div>
                    </div>

                  {evaluation.lastRun && (
                    <div className="text-sm text-gray-500">
                      Last run: {new Date(evaluation.lastRun).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-6">
              {evaluations.map((evaluation) => (
                <div key={evaluation.id} className="border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">{evaluation.name} - Confusion Matrix</h3>
                  <div className="mb-4 text-base">
                    <div className="mb-1"><span className="font-medium text-gray-700">True Positive:</span> <span className="font-bold text-green-800">{evaluation.confusionMatrix.truePositive}</span></div>
                    <div className="mb-1"><span className="font-medium text-gray-700">False Positive:</span> <span className="font-bold text-red-800">{evaluation.confusionMatrix.falsePositive}</span></div>
                    <div className="mb-1"><span className="font-medium text-gray-700">False Negative:</span> <span className="font-bold text-red-800">{evaluation.confusionMatrix.falseNegative}</span></div>
                    <div><span className="font-medium text-gray-700">True Negative:</span> <span className="font-bold text-green-800">{evaluation.confusionMatrix.trueNegative}</span></div>
                  </div>
                  {evaluation.additionalMetrics && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Additional Metrics:</h4>
                      <pre className="text-sm bg-gray-50 p-3 rounded border overflow-x-auto">
                        {JSON.stringify(evaluation.additionalMetrics, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'failures' && (
            <div className="space-y-6">
              {evaluations.map((evaluation) => (
                <div key={evaluation.id} className="border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">{evaluation.name} - Top Failures</h3>
                  {evaluation.topFailures.length > 0 ? (
                    <div className="mb-4 text-base">
                      {evaluation.topFailures.map((failure, index) => (
                        <div key={index} className="mb-2">
                          <span className="font-medium text-gray-700">{index + 1}. {failure.case}:</span> <span className="font-bold text-red-700">{failure.frequency} occurrence{failure.frequency !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle className="w-12 h-12 mx-auto text-green-400 mb-4" />
                      <p className="text-gray-500">No failures found - all tests are passing!</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

export default Evals;