import { useState, useEffect } from 'react'
import { User, CreditCard, Banknote, FileText } from 'lucide-react'

interface Card {
  id: string
  last4: string
  network: string
  status: string
  createdAt: any
}

interface Account {
  id: string
  balanceCents: number
  currency: string
}

interface CustomerData {
  id: string
  name: string
  emailMasked: string
  kycLevel: string
  createdAt: any
  cards?: Card[]
  accounts?: Account[]
  _count?: {
    transactions: number
    alerts: number
    cases: number
  }
  id_masked?: string
}


interface CustomerModalProps {
  customerId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const CustomerModal = ({ customerId, isOpen, onClose }: CustomerModalProps) => {
  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOpen || !customerId) return;
    setLoading(true);
    setCustomer(null);
    const fetchCustomerData = async () => {
      try {
        const customerResponse = await fetch(`/api/customer/${customerId}`, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sentinel-api-key-dev',
          },
        });
        if (customerResponse.ok) {
          const customerData = await customerResponse.json();
          setCustomer(customerData);
        }
      } catch (error) {
        console.error('Error fetching customer:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCustomerData();
  }, [customerId, isOpen]);


  if (!isOpen) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Customer Not Found</h1>
            <p className="text-gray-600">The requested customer could not be found.</p>
            <button
              className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formattedDate =
    customer.createdAt && Object.keys(customer.createdAt).length
      ? new Date(customer.createdAt).toLocaleDateString()
      : 'N/A'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl w-full relative">
        {/* Close Button */}
        <button
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 text-2xl font-bold"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        {/* Header */}
        <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Customer Profile</h1>
        <p className="text-gray-600">Comprehensive view of customer information and activity</p>
      </div>

      {/* Customer Info */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center">
          <User className="w-5 h-5 mr-2" />
          <h2 className="text-lg font-medium text-gray-900">Customer Information</h2>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID</label>
            <p className="text-gray-900">{customer.id}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Masked ID</label>
            <p className="text-gray-900">{customer.id_masked || 'N/A'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <p className="text-gray-900">{customer.name}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <p className="text-gray-900">{customer.emailMasked}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">KYC Level</label>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                customer.kycLevel === 'verified'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {customer.kycLevel}
            </span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Since</label>
            <p className="text-gray-900">{formattedDate}</p>
          </div>
        </div>
      </div>

      {/* Cards Section */}
      {customer.cards && customer.cards.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center">
            <CreditCard className="w-5 h-5 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">Cards</h2>
          </div>
          <div className="px-6 py-4 space-y-4">
            {customer.cards.map((card) => (
              <div key={card.id} className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b pb-3">
                <p><strong>ID:</strong> {card.id}</p>
                <p><strong>Network:</strong> {card.network}</p>
                <p><strong>Last 4:</strong> {card.last4}</p>
                <p>
                  <strong>Status:</strong>{' '}
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      card.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {card.status}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accounts Section */}
      {customer.accounts && customer.accounts.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center">
            <Banknote className="w-5 h-5 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">Accounts</h2>
          </div>
          <div className="px-6 py-4 space-y-4">
            {customer.accounts.map((acc) => (
              <div key={acc.id} className="grid grid-cols-1 md:grid-cols-3 gap-6 border-b pb-3">
                <p><strong>ID:</strong> {acc.id}</p>
                <p><strong>Balance:</strong> ${(acc.balanceCents / 100).toFixed(2)}</p>
                <p><strong>Currency:</strong> {acc.currency}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Counts */}
      {customer._count && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center">
            <FileText className="w-5 h-5 mr-2" />
            <h2 className="text-lg font-medium text-gray-900">Summary</h2>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transactions</label>
              <p className="text-gray-900">{customer._count.transactions}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alerts</label>
              <p className="text-gray-900">{customer._count.alerts}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cases</label>
              <p className="text-gray-900">{customer._count.cases}</p>
            </div>
          </div>
        </div>

      )}
      </div>
    </div>
  );
}

export default CustomerModal
