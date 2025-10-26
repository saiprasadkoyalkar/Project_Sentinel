import { useState, useEffect, useRef } from 'react';
import otherBg from './ui/other.png';
import ReactDOM from 'react-dom';
import LoadingSpinner from './LoadingSpinner';

function CollapsibleJson({ label, data }: { label: string; data: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button className="text-xs text-blue-600 underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} {label}
      </button>
      {open && (
        <pre className="bg-gray-50 border rounded p-2 mt-1 text-xs overflow-x-auto max-h-40">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}


interface TriageDrawerProps {
  alertId: string;
  customerId: string;
  suspectTxnId: string;
  cardId: string;
  isOpen: boolean;
  onClose: () => void;
  onActionComplete?: () => void;
  onRateLimit?: (retryAfterMs: number) => void;
}

type TriageEvent = {
  type: string;
  timestamp: string;
  runId: string;
  data: any;
};

type TriageStatus = {
  runId: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  risk?: string;
  reasons?: string[];
  fallbackUsed?: boolean;
  latencyMs?: number;
  traces?: any[];
};


const TriageDrawer = ({ alertId, customerId, suspectTxnId, cardId, isOpen, onClose, onActionComplete, onRateLimit }: TriageDrawerProps) => {
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<TriageEvent[]>([]);
  const [status, setStatus] = useState<TriageStatus | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate triage POSTs in dev/StrictMode
  const hasFetched = useRef(false);
  useEffect(() => {
    if (!isOpen || hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    setEvents([]);
    setStatus(null);
    setError(null);
    setRunId(null);

    fetch('/api/triage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sentinel-api-key-dev',
      },
      body: JSON.stringify({ alertId, customerId, suspectTxnId }),
    })
      .then(async (res) => {
        if (res.status === 429) {
          // Rate limited
          const retryAfter = res.headers.get('Retry-After');
          let retryAfterMs = 0;
          if (retryAfter) {
            // Retry-After can be seconds or ms, try to parse
            retryAfterMs = parseInt(retryAfter, 10);
            if (retryAfterMs < 1000) retryAfterMs = retryAfterMs * 1000; // assume seconds if too small
          } else {
            retryAfterMs = 5000; // fallback
          }
          if (typeof onRateLimit === 'function') {
            onRateLimit(retryAfterMs);
          }
          throw new Error('Rate limited. Please wait before retrying.');
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to start triage');
        }
        return res.json();
      })
      .then((data) => {
        setRunId(data.runId);
        // Open SSE connection
        const streamUrl = data.streamUrl.startsWith('/api') ? data.streamUrl : `/api/triage/${data.runId}/stream`;
        const apiKey = 'sentinel-api-key-dev';
        const urlWithKey = streamUrl.includes('?')
          ? `${streamUrl}&apiKey=${apiKey}`
          : `${streamUrl}?apiKey=${apiKey}`;
        const es = new window.EventSource(urlWithKey);
        eventSourceRef.current = es;
        es.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            setEvents((prev) => [...prev, parsed]);
            if (parsed.type === 'decision_finalized' || parsed.type === 'completed') {
              es.close();
              fetch(`/api/triage/${data.runId}`, {
                headers: { 'x-api-key': 'sentinel-api-key-dev' },
              })
                .then((res) => res.json())
                .then(setStatus)
                .catch(() => {});
            }
          } catch {}
        };
        es.onerror = () => {
          setError('Stream error or triage not found.');
          es.close();
        };
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => {
      hasFetched.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
    // eslint-disable-next-line
  }, [isOpen, alertId, customerId, suspectTxnId]);

  if (!isOpen) return null;

  // --- UI Sectioning ---
  // Action button state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOtpPrompt, setShowOtpPrompt] = useState(false);
  const [otpValue, setOtpValue] = useState('');

  // Helper: close and reset
  const handleClose = () => {
    setActionLoading(null);
    setActionError(null);
    setShowOtpPrompt(false);
    setOtpValue('');
    if (onActionComplete) onActionComplete();
    onClose();
  };

  // Freeze Card
  const handleFreezeCard = async () => {
  setActionError(null);

    setActionLoading('freeze');
    try {
      const res = await fetch('/api/action/freeze-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sentinel-api-key-dev',
        },
        body: JSON.stringify({ cardId, alertId, customerId, suspectTxnId, otp: otpValue || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Freeze failed');
      handleClose();
    } catch (e: any) {
      setActionError(e.message || 'Freeze failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Open Dispute
  const handleOpenDispute = async () => {
    setActionError(null);
    setActionLoading('dispute');
    try {
      const res = await fetch('/api/action/open-dispute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'x-api-key': 'sentinel-api-key-dev' },
        body: JSON.stringify({ txnId: suspectTxnId, reasonCode: 'UNAUTHORIZED_TRANSACTION' }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Dispute failed');
      handleClose();
    } catch (e: any) {
      setActionError(e.message || 'Dispute failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Contact Customer
  const handleContactCustomer = async () => {
    setActionError(null);
    setActionLoading('contact');
    try {
      const res = await fetch('/api/action/contact-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'x-api-key': 'sentinel-api-key-dev' },
        body: JSON.stringify({ alertId, customerId, suspectTxnId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Contact failed');
      handleClose();
    } catch (e: any) {
      setActionError(e.message || 'Contact failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Mark False Positive
  const handleFalsePositive = async () => {
    setActionError(null);
    setActionLoading('falsepos');
    try {
      const res = await fetch('/api/action/mark-false-positive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          'x-api-key': 'sentinel-api-key-dev' },
        body: JSON.stringify({ alertId, customerId, suspectTxnId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to mark false positive');
      handleClose();
    } catch (e: any) {
      setActionError(e.message || 'Failed to mark false positive');
    } finally {
      setActionLoading(null);
    }
  };
  // Use risk analysis from traces if available
  let riskScore: number | null = null;
  let riskAction: string | null = null;
  let riskReasons: string[] | null = null;
  let riskLevel: string | null = null;
  let riskConfidence: number | null = null;
  let keyFactors: string[] | null = null;
  let recommendedAction: string = 'Review Manually';
  if (status?.traces) {
    const riskTrace = status.traces.find(t => t.step === 'riskSignals');
    if (riskTrace && riskTrace.detail) {
      riskScore = riskTrace.detail.score;
      riskAction = riskTrace.detail.action;
      riskReasons = riskTrace.detail.reasons;
    }
    const decideTrace = status.traces.find(t => t.step === 'decide');
    if (decideTrace && decideTrace.detail && decideTrace.detail.riskAssessment) {
      riskLevel = decideTrace.detail.riskAssessment.level;
      riskConfidence = decideTrace.detail.riskAssessment.confidence;
      keyFactors = decideTrace.detail.riskAssessment.keyFactors;
    }
    const proposeActionTrace = status.traces.find(t => t.step === 'proposeAction');
    if (proposeActionTrace && proposeActionTrace.detail && proposeActionTrace.detail.action) {
      // Use action from proposeAction if available
      if (proposeActionTrace.detail.action === 'monitor') recommendedAction = 'Continue Monitoring';
      else if (proposeActionTrace.detail.action === 'freeze') recommendedAction = 'Freeze Card Immediately.';
      else if (proposeActionTrace.detail.action === 'contact_customer') recommendedAction = 'Contact Customer';
      else recommendedAction = proposeActionTrace.detail.action;
    } else if (riskAction) {
      if (riskAction === 'monitor') recommendedAction = 'Continue Monitoring';
      else if (riskAction === 'freeze') recommendedAction = 'Freeze Card Immediately.';
      else if (riskAction === 'contact_customer') recommendedAction = 'Contact Customer';
      else recommendedAction = riskAction;
    } else if (status?.risk === 'HIGH') {
      recommendedAction = 'Freeze Card Immediately.';
    }
  }
  // Fallbacks if not present
  riskReasons = riskReasons || status?.reasons || [
    'Transaction amount is 5x the customer\'s average.',
    'Merchant category (MCC 7995 - Gambling) is rare for this customer.',
    'Transaction occurred from a new, unrecognized device ID.'
  ];
  riskLevel = riskLevel || status?.risk || null;

  // Citations/KB mock (replace with real from status if available)
  const citedDocs = status?.traces?.find?.(t => t.kbDocs)?.kbDocs || [
    { id: '4.1', title: 'Policy #4.1: High-Risk MCC Transactions', link: '#' },
    { id: '7.2', title: 'Procedure #7.2: Handling Unrecognized Device Fraud', link: '#' },
  ];

  // Plan steps (from events)
  const planSteps = [
    { key: 'plan_built', label: 'Triage Started' },
    { key: 'getProfile', label: 'getProfile' },
    { key: 'recentTx', label: 'recentTx' },
    { key: 'riskSignals', label: 'riskSignals' },
    { key: 'kbLookup', label: 'kbLookup' },
    { key: 'decide', label: 'decide' },
    { key: 'proposeAction', label: 'proposeAction' },
    { key: 'decision_finalized', label: 'decision_finalized' },
  ];
  // Map event types to plan step status
  const stepStatus: Record<string, { status: string; duration?: number; note?: string }> = {};
  events.forEach(ev => {
    if (ev.type === 'tool_update' && ev.data?.step) {
      stepStatus[ev.data.step] = {
        status: ev.data.result?.error ? 'fail' : 'done',
        duration: ev.data.result?.latencyMs,
        note: ev.data.result?.error ? 'Error' : undefined,
      };
    }
    if (ev.type === 'decision_finalized') {
      stepStatus['decision_finalized'] = { status: 'done' };
    }
  });
  // Mark running step
  const lastStep = events.length > 0 ? events[events.length - 1] : null;
  if (lastStep && lastStep.type === 'tool_update' && lastStep.data?.step) {
    stepStatus[lastStep.data.step] = { status: 'running' };
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black bg-opacity-30">
      <div
        className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col animate-slideInRight"
        style={{
          backgroundImage: `url(${otherBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="text-lg font-semibold">Triage: Alert #{alertId}</div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-red-500 text-xl font-bold">×</button>
        </div>

        {/* Risk Summary */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-4 mb-2">
            <div className="flex items-center">
              <span className="font-medium mr-1">Risk Score:</span>
              <span className="text-red-600 font-bold text-lg">{riskScore !== null ? `${riskScore}/100` : 'N/A'}</span>
            </div>
            {riskLevel && (
              <>
                <span className="mx-3 h-5 border-l border-gray-300"></span>
                <div className="flex items-center">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${riskLevel === 'high' ? 'bg-red-200 text-red-800' : riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>{riskLevel.toUpperCase()}</span>
                </div>
              </>
            )}
            {riskConfidence !== null && (
              <>
                <span className="mx-3 h-5 border-l border-gray-300"></span>
                <div className="flex items-center">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-800 text-xs font-semibold">Confidence: {riskConfidence}%</span>
                </div>
              </>
            )}
          </div>
          {/* Deduplicate Key Factors and Top Reasons */}
          {(() => {
            const kf = (keyFactors || []).map(f => f.trim());
            const rr = (riskReasons as string[]).map(r => r.trim());
            // If both are present and not identical, show both
            const showBoth = kf.length > 0 && rr.length > 0 && (kf.join('|') !== rr.join('|'));
            if (showBoth) {
              return <>
                <div className="mb-2">
                  <div className="font-medium">Key Factors</div>
                  <ul className="list-disc ml-6 text-sm text-gray-700">
                    {kf.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
                <div className="mb-2">
                  <div className="font-medium">Top Reasons</div>
                  <ul className="list-disc ml-6 text-sm text-gray-700">
                    {rr.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              </>;
            } else if (kf.length > 0) {
              return <div className="mb-2">
                <div className="font-medium">Key Factors</div>
                <ul className="list-disc ml-6 text-sm text-gray-700">
                  {kf.map((f: string, i: number) => <li key={i}>{f}</li>)}
                </ul>
              </div>;
            } else if (rr.length > 0) {
              return <div className="mb-2">
                <div className="font-medium">Top Reasons</div>
                <ul className="list-disc ml-6 text-sm text-gray-700">
                  {rr.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>;
            }
            return null;
          })()}
          <div className="mt-2">
            <div className="font-medium">Recommended Action:</div>
            <div className="text-indigo-700 font-semibold">{recommendedAction}</div>
          </div>
        </div>

        {/* Execution Plan & Traces */}
        <div className="px-6 py-4 border-b flex-1 overflow-y-auto">
          <div className="font-medium mb-2">Execution Plan & Traces</div>
          <ul className="space-y-1">
            {planSteps.map((step, i: number) => {
              const s = stepStatus[step.key] || { status: 'pending' };
              return (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  {s.status === 'done' && <span title="Done">✅</span>}
                  {s.status === 'running' && <span title="Running">⏳</span>}
                  {s.status === 'pending' && <span title="Pending">⚪</span>}
                  {s.status === 'fail' && <span title="Timeout/Fallback">⚠️</span>}
                  <span className="font-mono">{step.label}</span>
                  {s.duration !== undefined && (
                    <span className="text-gray-500 ml-1">({s.duration}ms)</span>
                  )}
                  {s.note && <span className="text-xs text-orange-600 ml-2">- {s.note}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Citations & Knowledge Base */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="font-medium mb-2">Citations & Knowledge Base</div>
          <ul className="space-y-1">
            {(citedDocs as { id: string; title: string; link: string }[]).map((doc: { id: string; title: string; link: string }) => (
              <li key={doc.id} className="flex items-center gap-2 text-sm">
                <span role="img" aria-label="doc">📄</span>
                <a href={doc.link} className="text-blue-700 underline hover:text-blue-900" target="_blank" rel="noopener noreferrer">{doc.title}</a>
              </li>
            ))}
          </ul>
        </div>

        {/* Agent Actions */}
        <div className="px-6 py-4 bg-white flex flex-col gap-2">
          <div className="font-medium mb-2">Agent Actions</div>
          {actionError && <div className="text-red-600 text-sm mb-2">{actionError}</div>}
          {/* OTP Prompt for Freeze Card */}
          {showOtpPrompt && (
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                className="border rounded px-2 py-1 text-sm"
                placeholder="Enter OTP"
                value={otpValue}
                onChange={e => setOtpValue(e.target.value)}
                autoFocus
              />
              <button
                className="bg-indigo-600 text-white px-3 py-1 rounded font-semibold hover:bg-indigo-700"
                onClick={handleFreezeCard}
                disabled={actionLoading === 'freeze' || !otpValue}
              >Submit OTP</button>
              <button className="text-xs text-gray-500 ml-2" onClick={() => setShowOtpPrompt(false)}>Cancel</button>
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              className="bg-indigo-600 text-white px-4 py-2 rounded font-semibold shadow hover:bg-indigo-700 focus:outline-none disabled:opacity-60"
              onClick={() => setShowOtpPrompt(true)}
              disabled={actionLoading !== null}
            >Freeze Card (Recommended)</button>
            <button
              className="bg-yellow-500 text-white px-4 py-2 rounded font-semibold hover:bg-yellow-600 focus:outline-none disabled:opacity-60"
              onClick={handleOpenDispute}
              disabled={actionLoading !== null}
            >Open Dispute</button>
            <button
              className="bg-blue-200 text-blue-900 px-4 py-2 rounded font-semibold hover:bg-blue-300 focus:outline-none disabled:opacity-60"
              onClick={handleContactCustomer}
              disabled={actionLoading !== null}
            >Contact Customer</button>
            <button
              className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-semibold hover:bg-gray-300 focus:outline-none disabled:opacity-60"
              onClick={handleFalsePositive}
              disabled={actionLoading !== null}
            >Mark False Positive</button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('modal-root') as HTMLElement
  );
};

export default TriageDrawer;
