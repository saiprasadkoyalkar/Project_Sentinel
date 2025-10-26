import { useState, useEffect } from 'react';
import dashboardBg from '../components/ui/dashboard.png';
import { AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#140a85ff', '#dbe915ff', '#d85514ff', '#B066FF', '#FF6699', '#33CCFF'];

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [resolvedBreakdown, setResolvedBreakdown] = useState({
    resolved: 0,
    contacted: 0,
    closed_false_positive: 0,
  });
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [totalAlertAmount, setTotalAlertAmount] = useState(0);
  const [alertsByCountry, setAlertsByCountry] = useState<{ [key: string]: number }>({});
  const [alertsByCity, setAlertsByCity] = useState<{ [key: string]: number }>({});
  const [alertsByMerchant, setAlertsByMerchant] = useState<{ [key: string]: number }>({});
  const [avgResolutionTime, setAvgResolutionTime] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': 'sentinel-api-key-dev',
      };

      const statsRes = await fetch('/api/alerts/stats/summary', { headers });
      if (statsRes.ok) {
        const stats = await statsRes.json();
        const pending =
          (stats.byStatus?.['investigating'] || 0) +
          (stats.byStatus?.['investigating(opened the dispute)'] || 0);
        setPendingCount(pending);

        const resolved =
          (stats.byStatus?.['resolved'] || 0) +
          (stats.byStatus?.['contacted'] || 0) +
          (stats.byStatus?.['closed_false_positive'] || 0);
        setResolvedCount(resolved);

        setResolvedBreakdown({
          resolved: stats.byStatus?.['resolved'] || 0,
          contacted: stats.byStatus?.['contacted'] || 0,
          closed_false_positive: stats.byStatus?.['closed_false_positive'] || 0,
        });
      }

      const alertsRes = await fetch('/api/alerts', { headers });
      if (alertsRes.ok) {
        const alerts = await alertsRes.json();
        setTotalAlertAmount(alerts.reduce((sum: number, a: any) => sum + (a.amount || 0), 0));

        const countryCounts: { [key: string]: number } = {};
        const cityCounts: { [key: string]: number } = {};
        const merchantCounts: { [key: string]: number } = {};
        const mccCounts: { [key: string]: number } = {};
        let resolutionTimes: number[] = [];

        alerts.forEach((a: any) => {
          const country = a.transaction?.country || 'Unknown';
          const city = a.transaction?.city || 'Unknown';
          const merchant = a.transaction?.merchant || 'Unknown';
          const mcc = a.transaction?.mcc || 'Unknown';

          countryCounts[country] = (countryCounts[country] || 0) + 1;
          cityCounts[city] = (cityCounts[city] || 0) + 1;
          merchantCounts[merchant] = (merchantCounts[merchant] || 0) + 1;
          mccCounts[mcc] = (mccCounts[mcc] || 0) + 1;

          if (a.triageRun?.startedAt && a.triageRun?.endedAt) {
            const start = new Date(a.triageRun.startedAt).getTime();
            const end = new Date(a.triageRun.endedAt).getTime();
            if (end > start) resolutionTimes.push(end - start);
          }
        });

        setAlertsByCountry(countryCounts);
        setAlertsByCity(cityCounts);
        setAlertsByMerchant(merchantCounts);
        setAvgResolutionTime(
          resolutionTimes.length > 0
            ? Math.round(
                resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length / 1000
              )
            : null
        );
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-purple-100">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen p-10 font-sans"
      style={{
        backgroundImage: `url(${dashboardBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-white/75 backdrop-blur-sm z-0" />

      <div className="relative z-10 space-y-10">
        {/* Title */}
        <header className="text-center">
          <h1 className="text-6xl font-extrabold bg-gradient-to-r from-blue-700 via-purple-600 to-pink-500 bg-clip-text text-transparent drop-shadow-md tracking-tight">
            Sentinel Dashboard
          </h1>
          <p className="text-lg text-gray-700 mt-3 font-medium">
            Insights into <span className="text-blue-600 font-semibold">alert activity</span> and{' '}
            <span className="text-purple-600 font-semibold">resolution performance</span>
          </p>
        </header>

        {/* Upload Section */}
        <section className="bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200 shadow-xl rounded-2xl p-8 transition-all hover:shadow-2xl">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 flex items-center gap-2">
             Upload Data (.xlsx)
          </h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setUploadMsg(null);
              setUploading(true);
              const form = e.target as HTMLFormElement;
              const fileInput = form.elements.namedItem('xlsxFile') as HTMLInputElement;
              if (!fileInput.files?.length) {
                setUploadMsg('Please select an Excel (.xlsx) file.');
                setUploading(false);
                return;
              }
              const file = fileInput.files[0];
              const formData = new FormData();
              formData.append('file', file);

              try {
                const res = await fetch('/api/upload-excel', {
                  method: 'POST',
                  body: formData,
                });
                if (res.ok) {
                  setUploadMsg('Excel file uploaded successfully!');
                  form.reset();
                  await fetchData();
                } else setUploadMsg('Failed to upload Excel file.');
              } catch {
                setUploadMsg('Error uploading Excel file.');
              } finally {
                setUploading(false);
              }
            }}
            className="flex flex-col sm:flex-row items-center gap-4"
          >
            <input
              type="file"
              name="xlsxFile"
              accept=".xlsx"
              className="file-input file-input-bordered file-input-primary w-full sm:max-w-xs"
              required
              disabled={uploading}
            />
            <button
              type="submit"
              className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold rounded-lg shadow hover:scale-105 transition disabled:opacity-50"
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </form>
          {uploadMsg && (
            <p
              className={`mt-3 text-base font-semibold ${
                uploadMsg.includes('success') ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {uploadMsg}
            </p>
          )}
        </section>

        {/* Metrics Section */}
        <section>
          <h2 className="text-3xl font-extrabold text-gray-800 mb-6 border-b-4 border-blue-200 inline-block pb-2">
             Key Metrics
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <MetricCard
              color="yellow"
              title="Pending  "
              value={pendingCount}
              subtitle="investigating, investigating (opened the dispute)"
            />

            <MetricCard
              color="green"
              title="Resolved"
              value={resolvedCount}
              details={resolvedBreakdown}
            />

            <MetricCard
              color="blue"
              title="Total Alert Amount"
              value={totalAlertAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            />
          </div>
        </section>

        <section>
              <h2 className="text-3xl font-extrabold text-gray-800 mb-6 border-b-4 border-purple-200 inline-block pb-2">
                 Alert Distribution
              </h2>

              <div className="flex flex-row justify-center items-start flex-wrap gap-10">
                <div className="w-[300px] h-[320px]">
                  <PieChartCard title="Alerts by Country" data={alertsByCountry} color="cyan" />
                </div>

                <div className="w-[300px] h-[320px]">
                  <PieChartCard title="Alerts by City" data={alertsByCity} color="pink" />
                </div>

                <div className="w-[300px] h-[320px]">
                  <PieChartCard title="Alerts by Merchant" data={alertsByMerchant} color="orange" />
                </div>
              </div>
        </section>


      </div>
    </div>
  );
};

/* Helper Components */
const MetricCard = ({ color, title, value, subtitle, details }: any) => {
  return (
    <div
      className={`group relative overflow-hidden bg-gradient-to-br from-${color}-50 to-${color}-100 border border-${color}-200 rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-300`}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className={`text-lg font-bold text-${color}-800 tracking-tight`}>
            {title}
          </h3>
        </div>
        <span className={`text-2xl font-extrabold text-${color}-900`}>{value}</span>
      </div>

      {/* Details Section */}
      {details && (
        <div
          className={`pl-10 mt-3 text-sm text-${color}-800 space-y-1 border-l-4 border-${color}-300`}
        >
          {Object.entries(details).map(([key, val]) => (
            <div
              key={key}
              className="flex justify-between items-center pr-2 font-medium"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs text-gray-500">•</span>
                <span className="capitalize">
                  {key.replaceAll('_', ' ')} :
                </span>
              </span>
              <span className="font-semibold">{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};



const DataCard = ({ title, data, color }: any) => (
  <div
    className={`group bg-${color}-50 border border-${color}-200 shadow-lg rounded-2xl p-6 transition-all hover:shadow-xl hover:scale-105`}
  >
    <h3 className={`text-lg font-bold text-${color}-700 mb-3`}>{title}</h3>
    <div className={`grid grid-cols-1 gap-2 text-base text-${color}-900`}>
      {Object.entries(data).map(([key, val]) => (
        <div
          key={key}
          className={`flex justify-between items-center bg-${color}-100 rounded px-3 py-1 font-semibold shadow-sm`}
        >
          <span>{key}:</span>
          <span className={`text-${color}-900 font-bold ml-2`}>{val}</span>
        </div>
      ))}
    </div>
  </div>
);


const PieChartCard = ({ title, data, color }: any) => {
  const chartData = Object.entries(data).map(([key, value]) => ({
    name: key,
    value,
  }));

  return (
    <div
      className={`bg-${color}-50 border border-${color}-200 shadow-md rounded-2xl p-6 hover:shadow-xl transition-all`}
    >
      <h3 className={`text-lg font-bold text-${color}-800 mb-4 text-center`}>{title}</h3>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend layout="horizontal" verticalAlign="bottom" align="center" />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-center text-gray-500">No data available</p>
      )}
    </div>
  );
};


export default Dashboard;