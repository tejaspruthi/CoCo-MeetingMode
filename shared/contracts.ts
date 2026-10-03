import { z } from 'zod';
export const DATASET_VERSION = 'meridian-2026-09-v1';
export const SEMANTIC_VIEW = 'COCO_QBR_DEMO.ANALYTICS.QBR_FINANCE';
export const PlanSchema = z.object({
  metric: z.enum(['revenue', 'variance', 'margin']),
  region: z.enum(['ALL', 'Americas', 'EMEA', 'APAC']),
  segment: z.enum(['ALL', 'Enterprise', 'Commercial']),
  groupBy: z.enum(['none', 'region', 'segment', 'customer', 'product']),
  quarter: z.string().regex(/^202[56]-Q[1-4]$/),
  excludeLargest: z.boolean(),
  clarification: z.string().max(400).nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;
export type FinanceRow = {month:string; quarter:string; customer_id:string; customer:string; region:string; segment:string; product:string; actual_cents:number; budget_cents:number; cogs_cents:number; budget_cogs_cents:number};
export type ResultRow = {label:string; actual:number; budget:number; variance:number; variance_pct:number|null; gross_profit:number; gross_margin:number|null};
export type Evidence = {id:string; engine:'local-synthetic'|'snowflake'; queryId:string|null; sql:string; executedAt:string; datasetVersion:string; rows:ResultRow[]; durationMs:number; purpose:string};
export type Answer = {id:string; question:string; parentId?:string; plan:Plan; status:'queued'|'querying'|'answered'|'needs_clarification'|'failed'|'cancelled'; headline?:string; interpretation?:string; error?:string; evidence:Evidence[]; summary?:ResultRow; excludedCustomer?:string; pinned:boolean; createdAt:string};
export type Segment = {id:string; text:string; speaker:string; timestamp:string; source:'replay'|'zoom';};
export type Meeting = {id:string; title:string; quarter:string; topic:'revenue'|'margin'; startedAt:string; endedAt?:string; capture:'idle'|'replay'|'zoom'; transcript:Segment[]; answers:Answer[]; notes:string;};
export type Health = {mode:'demo'|'live'; snowflakeConfigured:boolean; cortexConfigured:boolean; zoomConfigured:boolean; liveEnabled:boolean; datasetVersion:string;};
