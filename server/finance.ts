import { randomUUID } from 'node:crypto';
import { DATASET_VERSION, SEMANTIC_VIEW, type Plan, type FinanceRow, type ResultRow, type Evidence } from '../shared/contracts.js';
import { data } from './data.js';
export function filterRows(plan:Plan, source=data) {
  return source.filter(r=>r.quarter===plan.quarter && (plan.region==='ALL'||r.region===plan.region) && (plan.segment==='ALL'||r.segment===plan.segment));
}
export function totals(rows:FinanceRow[],label='Total'):ResultRow {
  const sum=(key:'actual_cents'|'budget_cents'|'cogs_cents')=>rows.reduce((n,r)=>n+r[key],0);
  const a=sum('actual_cents'),b=sum('budget_cents'),c=sum('cogs_cents');
  return {label,actual:a/100,budget:b/100,variance:(a-b)/100,variance_pct:b?(a-b)/b*100:null,gross_profit:(a-c)/100,gross_margin:a?(a-c)/a*100:null};
}
export function largest(rows:FinanceRow[]) {
  const customers=new Map<string,FinanceRow[]>();
  rows.forEach(r=>customers.set(r.customer,[...(customers.get(r.customer)||[]),r]));
  return [...customers].map(([name,rs])=>({name,total:totals(rs).actual})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name))[0]?.name;
}
export function aggregate(rows:FinanceRow[], group:Plan['groupBy']):ResultRow[] {
  if(!rows.length) return [];
  if(group==='none') return [totals(rows)];
  const groups=new Map<string,FinanceRow[]>();
  rows.forEach(r=>groups.set(r[group],[...(groups.get(r[group])||[]),r]));
  return [...groups].map(([name,rs])=>totals(rs,name)).sort((a,b)=>b.actual-a.actual||a.label.localeCompare(b.label));
}
const lit=(x:string)=>`'${x.replaceAll("'","''")}'`;
export function semanticSQL(plan:Plan, excluded?:string, group=plan.groupBy):string {
  const filters=[`finance.quarter = ${lit(plan.quarter)}`];
  if(plan.region!=='ALL') filters.push(`finance.region = ${lit(plan.region)}`);
  if(plan.segment!=='ALL') filters.push(`finance.segment = ${lit(plan.segment)}`);
  if(excluded) filters.push(`finance.customer <> ${lit(excluded)}`);
  const dims=group==='none'?'':`DIMENSIONS finance.${group}\n  `;
  return `SELECT * FROM SEMANTIC_VIEW(\n  ${SEMANTIC_VIEW}\n  ${dims}METRICS finance.actual_revenue, finance.budget_revenue, finance.revenue_variance,\n    finance.revenue_variance_pct, finance.gross_profit, finance.gross_margin\n  WHERE ${filters.join(' AND ')}\n)${group==='none'?'':` ORDER BY actual_revenue DESC, ${group} ASC`} LIMIT 500`;
}
export function localAnalysis(plan:Plan):{rows:ResultRow[];summary:ResultRow;excludedCustomer?:string;evidence:Evidence[]} {
  const t=performance.now();
  let rows=filterRows(plan); const excludedCustomer=plan.excludeLargest?largest(rows):undefined;
  if(excludedCustomer) rows=rows.filter(r=>r.customer!==excludedCustomer);
  const result=aggregate(rows,plan.groupBy);
  if(!result.length) throw new Error('No records match this quarter and filter combination.');
  return {rows:result,summary:totals(rows),excludedCustomer,evidence:[{id:randomUUID(),engine:'local-synthetic',queryId:null,sql:semanticSQL(plan,excludedCustomer),executedAt:new Date().toISOString(),datasetVersion:DATASET_VERSION,rows:result,durationMs:Math.round(performance.now()-t),purpose:'Local calculation. SQL shown is the equivalent Snowflake query, not executed SQL.'}]};
}
export const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
export function headline(plan:Plan,row:ResultRow) {
 if(plan.metric==='margin') return `Gross margin is ${row.gross_margin?.toFixed(1)??'undefined'}% on ${money(row.actual)} revenue.`;
 if(plan.metric==='variance') return `Revenue is ${money(Math.abs(row.variance))} ${row.variance<0?'below':'above'} budget${row.variance_pct===null?'':` (${Math.abs(row.variance_pct).toFixed(1)}%)`}.`;
 return `Revenue is ${money(row.actual)}, against ${money(row.budget)} budget.`;
}
export function interpretation(plan:Plan,excluded?:string) {
 return `${plan.quarter} · ${plan.region==='ALL'?'All regions':plan.region} · ${plan.segment==='ALL'?'All segments':plan.segment} · USD · Recognized revenue${excluded?` · Excluding ${excluded} (largest by actual revenue in this scope)`:''}`;
}
