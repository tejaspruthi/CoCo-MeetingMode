import { PlanSchema, type Plan } from '../shared/contracts.js';
export const basePlan:Plan={metric:'variance',region:'ALL',segment:'ALL',groupBy:'region',quarter:'2026-Q3',excludeLargest:false,clarification:null};
/** Whether a question explicitly refers to the immediately preceding result. */
export function inheritsPriorScope(text:string):boolean {
 return /\b(exclude|without|same|that|those|it|follow[- ]?up|instead|also)\b/i.test(text);
}
export function parseDemoQuestion(text:string,parent?:Plan,quarter='2026-Q3',topic='revenue'):Plan {
 const q=text.toLowerCase(); const plan:Plan={...(parent??{...basePlan,quarter}),clarification:null};
 if(/\b(drop|delete|update|insert|grant|role|password|secret|execute|shell|ignore instructions)\b/.test(q)) return {...plan,clarification:'This demo supports read-only financial questions. Please ask about revenue, budget variance, or gross margin.'};
 if(/\b(arr|nrr|churn|forecast|cash|bookings|opex|operating|why.*customer)\b/.test(q)) return {...plan,clarification:'That metric or business explanation is outside this PoC. Try revenue versus budget, region/segment breakdowns, or gross margin.'};
 if(!/revenue|budget|miss|variance|margin|emea|europe|enterprise|commercial|exclude|largest|product|region|same|quarter|americas|apac/.test(q)) return {...plan,clarification:'Ask about recognized revenue, budget variance, or gross margin. Example: How much did EMEA enterprise miss budget?'};
 const period=q.match(/q([1-4])\s*(202[56])/i); if(period)plan.quarter=`${period[2]}-Q${period[1]}`;
 if(/last year/.test(q))plan.quarter=plan.quarter.replace(/^\d{4}/,y=>String(Number(y)-1));
 if(/last quarter|previous quarter/.test(q)){let [y,k]=plan.quarter.split('-Q').map(Number);k--;if(!k){k=4;y--;}plan.quarter=`${y}-Q${k}`;}
 if(/emea|europe/.test(q))plan.region='EMEA'; else if(/americas|america/.test(q))plan.region='Americas';else if(/apac|asia/.test(q))plan.region='APAC';
 if(/all regions|company.?wide|overall/.test(q))plan.region='ALL';
 if(/enterprise/.test(q))plan.segment='Enterprise';else if(/commercial/.test(q))plan.segment='Commercial';else if(/all segments|company.?wide|overall/.test(q))plan.segment='ALL';
 if(/gross margin/.test(q)||(/margin/.test(q)&&topic==='margin')){plan.metric='margin';plan.groupBy='product';}
 else if(/margin/.test(q))plan.clarification='Do you mean gross margin? This PoC supports gross margin, not operating margin.';
 else if(/miss|budget|variance|below/.test(q))plan.metric='variance';else if(/revenue/.test(q))plan.metric='revenue';
 if(/by product|product mix/.test(q))plan.groupBy='product';else if(/by customer|customers/.test(q))plan.groupBy='customer';else if(/by segment/.test(q))plan.groupBy='segment';else if(/by region|regions/.test(q))plan.groupBy='region';
 else if(/emea|enterprise|commercial|apac|americas/.test(q))plan.groupBy='customer';
 if(/exclude|without/.test(q)&&/largest|biggest/.test(q))plan.excludeLargest=true;
 if(/include.*largest|restore.*largest/.test(q))plan.excludeLargest=false;
 return PlanSchema.parse(plan);
}
