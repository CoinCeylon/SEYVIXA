import React from 'react';
import RequestForm from '../components/RequestForm';

export default function WorkspacePage() {
  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Procurement Workspace
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Screen 1: Create and manage purchase requests, compare supplier quotes, and monitor autonomous agents.
          </p>
        </div>

        {/* Screen 1 Component: Request Form (T9.5a) */}
        <RequestForm />
      </div>
    </div>
  );
}
