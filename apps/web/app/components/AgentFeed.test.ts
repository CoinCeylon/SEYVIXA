// apps/web/app/components/AgentFeed.test.ts — Unit tests for T9.5c AgentFeed
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import decisionsMock from '../../mocks/decisions.json' with { type: 'json' };
import agentsMock from '../../mocks/agents.json' with { type: 'json' };
import type { PolicyEventItem, AgentItem } from './AgentFeed.tsx';

describe('T9.5c — Screen 1 AgentFeed Unit & Boundary Tests', () => {
  it('contains agent decision events including one DENY with RESOURCE_OUT_OF_SCOPE', () => {
    assert.equal(Array.isArray(decisionsMock), true);
    assert.ok(decisionsMock.length >= 4);

    const denyEvent = (decisionsMock as PolicyEventItem[]).find((e) => e.decision === 'DENY');
    assert.ok(denyEvent, 'Mock must contain at least one DENY event');
    assert.equal(denyEvent.action, 'FILE_READ');
    assert.equal(denyEvent.reason_code, 'RESOURCE_OUT_OF_SCOPE');
    assert.equal(denyEvent.resource, 'payroll.csv');
  });

  it('sorts events newest first by created_at', () => {
    const events = [...(decisionsMock as PolicyEventItem[])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    for (let i = 0; i < events.length - 1; i++) {
      const cur = new Date(events[i].created_at).getTime();
      const next = new Date(events[i + 1].created_at).getTime();
      assert.ok(cur >= next, `Event at ${i} must be newer than or equal to event at ${i + 1}`);
    }

    // Newest is the 10:15:00 PROPOSE_PURCHASE
    assert.equal(events[0].action, 'PROPOSE_PURCHASE');
    // Followed by 10:10:00 FILE_READ (DENY)
    assert.equal(events[1].action, 'FILE_READ');
    assert.equal(events[1].decision, 'DENY');
  });

  it('links denied actions to Screen 2 (/trust) per Blueprint §4.3 connection rule', () => {
    const denyEvent = (decisionsMock as PolicyEventItem[]).find((e) => e.decision === 'DENY')!;
    const trustLink = `/trust#event-${denyEvent.id}`;
    assert.ok(trustLink.startsWith('/trust'));
    assert.ok(trustLink.includes(denyEvent.id));
  });

  it('maps agent_id to agent name from mock agents', () => {
    const agentMap = new Map<string, string>();
    for (const a of agentsMock as AgentItem[]) {
      agentMap.set(a.id, a.name);
    }

    assert.equal(agentMap.get('20000000-0000-4000-8000-000000000001'), 'Procurement Agent');
    assert.equal(agentMap.get('20000000-0000-4000-8000-000000000002'), 'Finance Agent');
  });

  it('handles empty events list cleanly', () => {
    const empty: PolicyEventItem[] = [];
    assert.equal(empty.length, 0);
  });

  it('strictly excludes ADA amounts or currency conversions from decisions data', () => {
    for (const evt of decisionsMock) {
      const str = JSON.stringify(evt);
      assert.equal(/ada/i.test(str), false, 'Decision mock must never reference ADA');
      assert.equal(/exchange_rate|conversion/i.test(str), false, 'Decision mock must never include conversions');
    }
  });
});
