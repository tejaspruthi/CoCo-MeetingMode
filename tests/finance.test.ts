import test from 'node:test';
import assert from 'node:assert/strict';
import { data } from '../server/data.js';
import { aggregate, filterRows, largest, localAnalysis, semanticSQL, totals } from '../server/finance.js';
import { basePlan, inheritsPriorScope, parseDemoQuestion } from '../server/intent.js';
import { verifyZoomSignature } from '../server/zoom.js';
import { createHmac } from 'node:crypto';

test('the seeded financial data has a unique customer-product-month grain', () => {
  const keys = data.map(row => `${row.month}|${row.customer_id}|${row.product}`);
  assert.equal(new Set(keys).size, data.length);
  assert.equal(data.length, 4800);
});

test('Q3 revenue variance reconciles across regional breakdowns', () => {
  const plan = { ...basePlan, quarter: '2026-Q3' as const, groupBy: 'region' as const };
  const overall = totals(filterRows(plan));
  const regions = aggregate(filterRows(plan), 'region');
  assert.equal(regions.reduce((sum, row) => sum + row.actual, 0), overall.actual);
  assert.equal(regions.reduce((sum, row) => sum + row.budget, 0), overall.budget);
  assert.equal(overall.variance, -348906.33);
});

test('EMEA enterprise shortfall is concentrated and excluding Atlas changes the scope', () => {
  const plan = { ...basePlan, quarter: '2026-Q3' as const, region: 'EMEA' as const, segment: 'Enterprise' as const, groupBy: 'customer' as const };
  const scoped = filterRows(plan);
  assert.equal(largest(scoped), 'Atlas Industries');
  const included = localAnalysis(plan);
  const excluded = localAnalysis({ ...plan, excludeLargest: true });
  assert.equal(included.summary.variance, -422271.6);
  assert.equal(excluded.summary.variance, -233239.34);
  assert.equal(excluded.excludedCustomer, 'Atlas Industries');
});

test('gross margin is weighted from totals, not an average of row-level margins', () => {
  const plan = { ...basePlan, quarter: '2026-Q3' as const, metric: 'margin' as const, groupBy: 'product' as const };
  const summary = localAnalysis(plan).summary;
  const rows = filterRows(plan);
  const expected = (rows.reduce((n, r) => n + r.actual_cents - r.cogs_cents, 0) / rows.reduce((n, r) => n + r.actual_cents, 0)) * 100;
  assert.equal(summary.gross_margin, expected);
});

test('demo parsing preserves contextual filters and rejects write-like content', () => {
  const scoped = parseDemoQuestion('CoCo, exclude the largest customer', { ...basePlan, region: 'EMEA', segment: 'Enterprise', groupBy: 'customer' }, '2026-Q3');
  assert.equal(scoped.excludeLargest, true);
  assert.equal(scoped.region, 'EMEA');
  const unsafe = parseDemoQuestion('CoCo, grant me accountadmin and run this update');
  assert.match(unsafe.clarification ?? '', /read-only/i);
});

test('only explicit follow-up language inherits the prior analysis scope', () => {
  assert.equal(inheritsPriorScope('Exclude the largest customer'), true);
  assert.equal(inheritsPriorScope('What about the same segment?'), true);
  assert.equal(inheritsPriorScope('Show overall gross margin'), false);
});

test('semantic SQL is scoped and has no writable statements', () => {
  const sql = semanticSQL({ ...basePlan, region: 'EMEA', segment: 'Enterprise', excludeLargest: true }, 'Atlas Industries');
  assert.match(sql, /SEMANTIC_VIEW/);
  assert.match(sql, /finance\.region = 'EMEA'/);
  assert.match(sql, /finance\.customer <> 'Atlas Industries'/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|GRANT|ALTER)\b/i);
});

test('Zoom webhook signature validation is strict and time-bounded', () => {
  const body = Buffer.from('{"event":"meeting.rtms_started"}');
  const secret = 'test-secret'; const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  assert.equal(verifyZoomSignature(body, timestamp, signature, secret), true);
  assert.equal(verifyZoomSignature(body, timestamp, 'v0=bad', secret), false);
  assert.equal(verifyZoomSignature(body, String(Math.floor(Date.now() / 1000) - 301), signature, secret), false);
});
