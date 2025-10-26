import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { User, CreditCard, AlertTriangle, History } from 'lucide-react'

interface CustomerData {
  id: string
  name: string
  email: string
  kycLevel: string
  createdAt: string
}

interface Transaction {
  id: string
  amount: number
  merchant: string
  timestamp: string
  status: string
}

const Customer = () => {
  const { id } = useParams<{ id: string }>()
  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  console.log('Customer component rendered with ID:', id)

  useEffect(() => {
    const fetchCustomerData = async () => {
      if (!id) return

      try {
        // Fetch customer details
        const customerResponse = await fetch(`/api/customer/${id}`, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sentinel-api-key-dev'
          }
        })
        
        console.log('Customer response status:', customerResponse.status)
        if (customerResponse.ok) {
          const customerData = await customerResponse.json()
          console.log('Customer data received:', customerData)
          setCustomer(customerData)
        } else {
          console.error('Failed to fetch customer:', customerResponse.status, customerResponse.statusText)
        }

        // Fetch customer transactions
        const transactionsResponse = await fetch(`/api/customer/${id}/transactions`, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sentinel-api-key-dev'
          }
        })
        
        console.log('Transactions response status:', transactionsResponse.status)
        if (transactionsResponse.ok) {
          const transactionsData = await transactionsResponse.json()
          console.log('Transactions data received:', transactionsData)
          setTransactions(transactionsData.items || transactionsData)
        } else {
          console.error('Failed to fetch transactions:', transactionsResponse.status, transactionsResponse.statusText)
        }
      } catch (error) {
        console.error('Failed to fetch customer data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchCustomerData()
  }, [id])

  if (loading) {
    console.log('Customer component: Loading state')
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!customer) {
    console.log('Customer component: No customer found')
    return (
      <div className="p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Customer Not Found</h1>
          <p className="text-gray-600">The requested customer could not be found.</p>
        </div>
      </div>
    )
  }

  console.log('Customer component: Rendering customer data', customer)

  return (
    <div className="p-6">
      {/* Debug info */}
      <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <p className="text-sm text-yellow-800">Debug: Customer ID = {id}</p>
        <p className="text-sm text-yellow-800">Debug: Customer data loaded = {customer ? 'Yes' : 'No'}</p>
        <p className="text-sm text-yellow-800">Debug: Transactions count = {transactions.length}</p>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Customer Profile</h1>
        <p className="text-gray-600">Comprehensive view of customer information and activity</p>
      </div>

      {/* Customer Info */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <User className="w-5 h-5 mr-2" />
            Customer Information
          </h2>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <p className="text-gray-900">{customer.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <p className="text-gray-900">{customer.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">KYC Level</label>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                customer.kycLevel === 'verified' 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {customer.kycLevel}
              </span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Since</label>
              <p className="text-gray-900">{new Date(customer.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <History className="w-5 h-5 mr-2" />
            Recent Transactions
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {transactions.length > 0 ? (
            transactions.map((transaction) => (
              <div key={transaction.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <CreditCard className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">{transaction.merchant}</span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        transaction.status === 'completed' 
                          ? 'bg-green-100 text-green-800'
                          : transaction.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {transaction.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {new Date(transaction.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      ${transaction.amount.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="px-6 py-12 text-center">
              <CreditCard className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No transactions found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Customer