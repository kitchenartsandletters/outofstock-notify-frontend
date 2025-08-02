// SystemStatusDashboard.tsx
import React from 'react';

const mockServices = [
  {
    name: 'Out-of-Stock Notify API',
    status: 'Healthy',
    lastChecked: new Date().toLocaleString(),
  },
  {
    name: 'Admin Dashboard Frontend',
    status: 'Healthy',
    lastChecked: new Date().toLocaleString(),
  },
  {
    name: 'Webhook Listener',
    status: 'Degraded',
    lastChecked: new Date().toLocaleString(),
  },
];

const statusColor = (status: string) => {
  switch (status) {
    case 'Healthy':
      return 'bg-green-100 text-green-700 border-green-300';
    case 'Degraded':
      return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    case 'Offline':
      return 'bg-red-100 text-red-700 border-red-300';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300';
  }
};

const SystemStatusDashboard: React.FC = () => {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold mb-4">System Status</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mockServices.map((svc, idx) => (
          <div
            key={idx}
            className={`border rounded-lg p-4 shadow-md dark:bg-gray-800 dark:border-gray-700 ${statusColor(
              svc.status
            )}`}
          >
            <h2 className="text-lg font-bold mb-2">{svc.name}</h2>
            <p className="text-sm">Status: <strong>{svc.status}</strong></p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Last checked: {svc.lastChecked}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SystemStatusDashboard;