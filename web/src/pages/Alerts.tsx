import { useState, useEffect, useRef } from 'react'
import otherBg from '../components/ui/other.png';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { AlertTriangle } from 'lucide-react'
import LoadingSpinner from '../components/LoadingSpinner'
import CustomerModal from '../components/CustomerModal'
import TransactionsModal from '../components/TriageModal'
import TriageDrawer from '../components/TriageDrawer'

interface Transaction {
  id: string
  amount: number
  merchant: string
  timestamp: string
  status: string
  mcc: string
  country?: string
  city?: string
}


interface Alert {
  id: string
  customer: {
    id: string
    name: string
    email?: string
  }
  type: string
  severity: 'high' | 'medium' | 'low'
  status: 'open' | 'investigating' | 'resolved' | 'investigating(opened the dispute)'
  timestamp: string
  description: string
  amount?: number
  transaction?: {
    id: string
    merchant: string
    mcc: string
    country?: string
    city?: string
    timestamp: string
    card_id?: string
  }
}

const Alerts = () => {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [transactionCustomerId, setTransactionCustomerId] = useState<string | null>(null)
  const [isTransactionOpen, setIsTransactionOpen] = useState(false)
  const [isTriageDrawerOpen, setIsTriageDrawerOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [triageDisabled, setTriageDisabled] = useState<{ [alertId: string]: boolean }>({});
  const retryTimeouts = useRef<{ [alertId: string]: NodeJS.Timeout }>({});
  const handleViewCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedCustomerId(null)
  }

  const handleOpenTransaction = (customerId: string) => {
    setTransactionCustomerId(customerId)
    setIsTransactionOpen(true)
  }

  const handleCloseTransaction = () => {
    setIsTransactionOpen(false)
    setTransactionCustomerId(null)
  }


  const handleOpenTriageDrawer = (alert: Alert) => {
    // Only open if not disabled
    if (triageDisabled[alert.id]) return;
    setSelectedAlert(alert)
    setIsTriageDrawerOpen(true)
  }

  
  const handleTriageRateLimit = (alertId: string, retryAfterMs: number) => {
    setTriageDisabled(prev => ({ ...prev, [alertId]: true }));
    // Clear any previous timeout for this alert
    if (retryTimeouts.current[alertId]) {
      clearTimeout(retryTimeouts.current[alertId]);
    }
    retryTimeouts.current[alertId] = setTimeout(() => {
      setTriageDisabled(prev => ({ ...prev, [alertId]: false }));
      delete retryTimeouts.current[alertId];
    }, retryAfterMs);
  };

  const handleCloseTriageDrawer = () => {
    setIsTriageDrawerOpen(false)
    setSelectedAlert(null)
  }


  
  const fetchAlerts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/alerts', {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sentinel-api-key-dev'
        }
      })
      if (response.ok) {
        const data = await response.json()
        setAlerts(data)
      } else {
        console.error('Failed to fetch alerts:', response.status, response.statusText)
        setAlerts([])
      }
    } catch (error) {
      console.error('Failed to fetch alerts:', error)
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAlerts()
  }, [])

  
  const handleActionComplete = () => {
    fetchAlerts();
  }

  
  const filteredAlerts = alerts.filter(alert => alert.status == 'investigating' || alert.status == 'investigating(opened the dispute)')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div
      className="relative min-h-screen p-6 space-y-8"
      style={{
        backgroundImage: `url(${otherBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      
      <div className="absolute inset-0 bg-white/70 pointer-events-none z-0" />
      <div className="relative z-10">
  {/* Header Section */}
  <div className="text-center">
              <h1>
                  Security Alerts Dashboard
              </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Monitor and manage security alerts with AI-powered insights and real-time threat detection
        </p>
      </div>

      

      
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-white/30 overflow-hidden">
        <div className="px-8 py-6 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div>
                <h2 className="text-2xl font-bold">Active Security Alerts</h2>
                <p className="text-white/80">
                  {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''} requiring attention
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3 bg-white/10 rounded-lg px-4 py-2 backdrop-blur-sm">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium">Live Updates</span>
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-full bg-white/50 backdrop-blur-sm border border-gray-300 border-collapse">
            <TableHeader className="bg-gradient-to-r from-gray-50 to-gray-100">
              <TableRow className="border-b border-gray-300">
                <TableHead className="px-8 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                   Customer Name
                </TableHead>
                <TableHead className="px-8 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                   Risk Level
                </TableHead>
                <TableHead className="px-8 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                  Status
                </TableHead>
                <TableHead className="px-8 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                   Transaction Details
                </TableHead>
                <TableHead className="px-8 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                   Date & Time
                </TableHead>
                <TableHead className="px-8 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider border-b border-gray-300">
                   Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-300">
              {filteredAlerts.length > 0 ? (
                filteredAlerts.map((alert) => (
                  <TableRow 
                    key={alert.id} 
                    className="hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-purple-50/50 transition-all duration-300 group border-b border-gray-300"
                  >
                    
                    <TableCell className="px-8 py-6 whitespace-nowrap border-r border-gray-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
                            {alert.customer.name.charAt(0)}
                          </div>
                          <div className="ml-4">
                            <div className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                              {alert.customer.name}
                            </div>
                            <div className="text-sm text-gray-500 flex items-center space-x-2">
                              <span> {alert.customer.id}</span>
                            </div>
                          </div>
                        </div>
                        <button 
                          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-2 rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 text-sm font-medium"
                          onClick={() => handleViewCustomer(alert.customer.id)}
                          title="View Customer Details"
                        >
                          👤 View Profile
                        </button>
                      </div>
                    </TableCell>

                    
                    <TableCell className="px-8 py-6 whitespace-nowrap border-r border-gray-300">
                      <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-bold shadow-lg transform group-hover:scale-105 transition-all duration-200 ${
                        alert.severity === 'high' 
                          ? 'bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-red-500/25' 
                          : alert.severity === 'medium' 
                          ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white shadow-yellow-500/25' 
                          : 'bg-gradient-to-r from-green-400 to-blue-500 text-white shadow-green-500/25'
                      }`}>
                        {alert.severity === 'high'}
                        {alert.severity === 'medium'}
                        {alert.severity === 'low'}
                        <span className="ml-2">{alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)} Risk</span>
                      </span>
                    </TableCell>

                    
                    <TableCell className="px-8 py-6 whitespace-nowrap border-r border-gray-300">
                      <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium shadow-md transform group-hover:scale-105 transition-all duration-200 ${
                        alert.status === 'open' 
                          ? 'bg-gradient-to-r from-red-100 to-red-200 text-red-800 border border-red-300' 
                          : alert.status === 'investigating'
                          ? 'bg-gradient-to-r from-yellow-100 to-yellow-200 text-yellow-800 border border-yellow-300'
                          : 'bg-gradient-to-r from-green-100 to-green-200 text-green-800 border border-green-300'
                      }`}>
                        {alert.status === 'open'}
                        {alert.status === 'investigating'}
                        {alert.status === 'resolved'}
                        <span className="ml-2">{alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}</span>
                      </span>
                    </TableCell>

                    
                    <TableCell className="px-8 py-6 border-r border-gray-300">
                      {alert.transaction ? (
                        <div className="space-y-2">
                          <div className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                            <span></span>
                            <span>{alert.transaction.merchant}</span>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            {alert.transaction.city && alert.transaction.country && (
                              <div className="flex items-center space-x-2">
                                <span></span>
                                <span>{alert.transaction.city}, {alert.transaction.country}</span>
                              </div>
                            )}
                            {alert.amount && (
                              <div className="flex items-center space-x-2">
                                <span></span>
                                <span className="text-red-600 font-bold text-lg">${alert.amount.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2 text-gray-400">
                          <span></span>
                          <span>No transaction data</span>
                        </div>
                      )}
                    </TableCell>

                    
                    <TableCell className="px-8 py-6 whitespace-nowrap border-r border-gray-300">
                      <div className="text-sm text-gray-900 space-y-1">
                        <div className="font-medium flex items-center space-x-2">
                          <span></span>
                          <span>{new Date(alert.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div className="text-gray-500 flex items-center space-x-2">
                          <span></span>
                          <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </TableCell>

                    
                    <TableCell className="px-8 py-6 whitespace-nowrap text-center border-r border-gray-300">
                      <div className="flex flex-col space-y-3">
                        
                        <button 
                          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 font-medium"
                          onClick={() => handleOpenTransaction(alert.customer.id)}
                        >
                          See Recent Transactions
                        </button>
                        
                        {alert.status !== 'investigating(opened the dispute)' && (
                          <button
                            className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 font-medium disabled:opacity-60"
                            onClick={() => handleOpenTriageDrawer(alert)}
                            disabled={!!triageDisabled[alert.id]}
                            title={triageDisabled[alert.id] ? 'Rate limited. Please wait.' : 'Open Triage'}
                          >
                             Open Triage
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="px-8 py-16 text-center">
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <div className="w-24 h-24 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center">
                        <span className="text-4xl"></span>
                      </div>
                      <div className="text-gray-500">
                        <div className="text-xl font-bold mb-2 text-gray-700">No alerts found</div>
                        <p className="text-gray-500 max-w-md">
                          All systems are secure and running smoothly! 
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      
      {transactionCustomerId && (
        <TransactionsModal
          customerId={transactionCustomerId}
          isOpen={isTransactionOpen}
          onClose={handleCloseTransaction}
        />
      )}

      
      {selectedCustomerId && (
        <CustomerModal
          customerId={selectedCustomerId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      )}

      
      {selectedAlert && (
        <TriageDrawer
          alertId={selectedAlert.id}
          customerId={selectedAlert.customer.id}
          suspectTxnId={selectedAlert.transaction?.id || ''}
          cardId={selectedAlert.transaction?.card_id || ''}
          isOpen={isTriageDrawerOpen}
          onClose={handleCloseTriageDrawer}
          onActionComplete={handleActionComplete}
          onRateLimit={(retryAfterMs) => handleTriageRateLimit(selectedAlert.id, retryAfterMs)}
        />
      )}
      </div>
    </div>
  )
}

export default Alerts