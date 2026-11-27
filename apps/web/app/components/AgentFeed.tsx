'use client';

import React from 'react';
import Link from 'next/link';
import defaultEvents from '../../mocks/decisions.json';
import defaultAgents from '../../mocks/agents.json';

export interface PolicyEventItem {
  id: string;
  agent_id: string | null;
  action: string;
  decision: 'ALLOW' | 'DENY' | 'APPROVAL_REQUIRED';
  reason_code: string;
  created_at: string;
  procurement_id?: string | null;
  action_id?: string | null;
  resource?: string | null;
}

export interface AgentItem {
  id: string;
  name: string;
  status: string;
  credential_hash?: string | null;
}

interface AgentFeedProps {
  events?: PolicyEventItem[];
  agents?: AgentItem[];
}

export function formatActionLabel(action: string): string {
  switch (action) {
    case 'SUPPLIER_SEARCH':
      return 'Supplier Search';
    case 'QUOTE_READ':
      return 'Read Supplier Quotes';
    case 'FILE_READ':
      return 'File Read Request';
    case 'PROPOSE_PURCHASE':
      return 'Prepare Purchase Proposal';
    default:
      return action.replace(/_/g, ' ');
  }
}

export function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }) + ' UTC';
  } catch {
    return isoString;
  }
}

export default function AgentFeed({
  events = defaultEvents as PolicyEventItem[],
  agents = defaultAgents as AgentItem[],
}: AgentFeedProps) {
  const agentMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      map.set(a.id, a.name);
    }
    return map;
  }, [agents]);

  // Sort newest first as required by T9.5c
  const sortedEvents = React.useMemo(() => {
    if (!events || events.length === 0) return [];
    return [...events].sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeB - timeA;
    });
  }, [events]);

  if (!sortedEvents || sortedEvents.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h3 className="mt-3 text-base font-semibold text-slate-900">No agent activity yet</h3>
        <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
          Autonomous agent tool calls, search attempts, and proposals will stream into this feed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-slate-50/60 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            Agent Activity Feed
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
              {sortedEvents.length} Events (Newest First)
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time feed of agent proposals, protected tool calls, and gateway policy evaluations.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 border border-emerald-200 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Gateway Enforcement Active</span>
        </div>
      </div>

      {/* Feed List */}
      <div className="divide-y divide-slate-100">
        {sortedEvents.map((evt) => {
          const agentName = evt.agent_id ? agentMap.get(evt.agent_id) || 'Unknown Agent' : 'System Agent';
          const isDenied = evt.decision === 'DENY';
          const isApprovalRequired = evt.decision === 'APPROVAL_REQUIRED';
          const isAllowed = evt.decision === 'ALLOW';

          return (
            <div
              key={evt.id}
              className={`p-5 transition-colors ${
                isDenied ? 'bg-rose-50/40 hover:bg-rose-50/70' : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                {/* Agent & Action */}
                <div className="flex items-start sm:items-center gap-3">
                  <div
                    className={`mt-0.5 sm:mt-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      isDenied
                        ? 'bg-rose-100 text-rose-700 border border-rose-200'
                        : isApprovalRequired
                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    }`}
                  >
                    {isDenied ? '✕' : isApprovalRequired ? '!' : '✓'}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{agentName}</span>
                      <span className="text-xs text-slate-400 font-mono">
                        {evt.agent_id ? evt.agent_id.slice(-4) : ''}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-600">
                      {formatActionLabel(evt.action)}
                      {evt.resource && (
                        <span className="ml-1.5 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-700">
                          {evt.resource}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Decision Badge & Timestamp */}
                <div className="flex items-center gap-3 self-start sm:self-auto">
                  <span className="text-xs font-mono text-slate-400">
                    {formatTime(evt.created_at)}
                  </span>

                  {isAllowed && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      ALLOW
                    </span>
                  )}

                  {isApprovalRequired && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                      APPROVAL REQUIRED
                    </span>
                  )}

                  {isDenied && (
                    <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 border border-rose-200">
                      DENY
                    </span>
                  )}
                </div>
              </div>

              {/* Special Denied Action Callout — Links to Screen 2 (/trust) */}
              {isDenied && (
                <div className="mt-3 ml-11 rounded-lg bg-rose-100/70 border border-rose-200 p-3 text-xs text-rose-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold">Access Blocked:</span> Attempted to access unauthorized resource{' '}
                      <code className="bg-rose-200/70 px-1 py-0.5 rounded font-mono font-semibold">
                        {evt.resource}
                      </code>{' '}
                      (Reason: <span className="font-mono font-semibold">{evt.reason_code}</span>)
                    </div>
                    {/* Blueprint Section 4.3 Connection Rule */}
                    <Link
                      href={`/trust#event-${evt.id}`}
                      className="inline-flex items-center gap-1 rounded bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-rose-800 transition-colors"
                      title="Inspect policy denial on Screen 2 (Trust & Approval Centre)"
                    >
                      <span>View in Screen 2 Log</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <span>
          Denied agent actions link directly to Screen 2 (Trust &amp; Approval Centre) audit log.
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          Blueprint §4.3 Connection Rule
        </span>
      </div>
    </div>
  );
}
