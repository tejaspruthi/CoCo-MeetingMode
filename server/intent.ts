import type { Plan } from '../shared/contracts.js';
export const basePlan:Plan={metric:'variance',region:'ALL',segment:'ALL',groupBy:'region',quarter:'2026-Q3',excludeLargest:false,clarification:null};
/** Whether a question explicitly refers to the immediately preceding result. */
export function inheritsPriorScope(text:string):boolean {
 return /\b(exclude|without|same|that|those|it|follow[- ]?up|instead|also)\b/i.test(text);
}
