import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import LoadingSpinner from './LoadingSpinner';
import { X } from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  merchant: string;
  timestamp: string;
  status: string;
  mcc: string;
  country?: string;
  city?: string;
}

interface TriageModalProps {
  customerId: string;
  isOpen: boolean;
  onClose: () => void;
}

const TransactionsModal = ({ customerId, isOpen, onClose }: TriageModalProps) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !customerId) return;

    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/customer/${customerId}/transactions?limit=20`, {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sentinel-api-key-dev',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const transactionArray = Array.isArray(data)
            ? data
            : data.transactions
            ? data.transactions
            : data.items
            ? data.items
            : [];
          setTransactions(transactionArray);
        } else {
          setTransactions([]);
        }
      } catch (error) {
        setTransactions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [customerId, isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center z-[90] bg-black bg-opacity-50"
      style={{
        backgroundImage: 'url(/src/components/ui/other.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        // fallback overlay
        // The bg-black bg-opacity-50 class will still apply for dark overlay
      }}
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden m-4">
        {/* Header */}
        <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Customer Transaction</h2>
          <button onClick={onClose} className="text-white hover:text-gray-200">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <>
              <h3 className="text-lg font-semibold mb-4">Recent Transactions ({transactions.length})</h3>
              {transactions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Merchant</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {transactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {new Date(transaction.timestamp).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">{transaction.merchant}</td>
                          <td className="px-4 py-2 text-sm font-semibold text-gray-900">
                            {typeof transaction.amount === 'number' ? `$${transaction.amount.toLocaleString()}` : 'N/A'}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {transaction.city && transaction.country
                              ? `${transaction.city}, ${transaction.country}`
                              : 'N/A'}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <span
                              className={`px-2 py-1 text-xs rounded-full ${
                                transaction.status === 'completed'
                                  ? 'bg-green-100 text-green-800'
                                  : transaction.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {transaction.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No transactions found for this customer.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.getElementById('modal-root') as HTMLElement);
};

export default TransactionsModal;
