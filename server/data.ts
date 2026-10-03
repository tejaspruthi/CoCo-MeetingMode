import type { FinanceRow } from '../shared/contracts.js';
// Entire generator uses integer cents. There is one unique row per month/customer/product.
export function generateData(): FinanceRow[] {
  const rows:FinanceRow[]=[];
  for(let m=0;m<24;m++) {
    const date=new Date(Date.UTC(2024,9+m,1));
    const year=date.getUTCFullYear(), monthNum=date.getUTCMonth()+1;
    const month=`${year}-${String(monthNum).padStart(2,'0')}-01`;
    const quarter=`${year}-Q${Math.ceil(monthNum/3)}`;
    for(let c=1;c<=100;c++) for(let p=0;p<2;p++) {
      const region=['EMEA','Americas','APAC'][(c-1)%3];
      const segment=c%2===1?'Enterprise':'Commercial';
      const budget=(c===1?8500000:segment==='Enterprise'?1450000:380000)+c*1130+p*235000+m*18000;
      let actual=budget+((c*17+m*11+p*7)%13-6)*5500;
      if(quarter==='2026-Q3') {
        if(region==='EMEA'&&segment==='Enterprise') actual-=Math.round(budget*(c===1?0.35:0.12));
        else if(region==='Americas') actual+=Math.round(budget*0.025);
      }
      const costRate=p===0?0.20:quarter==='2026-Q3'?0.36:0.29;
      rows.push({month,quarter,customer_id:`C${String(c).padStart(3,'0')}`,customer:c===1?'Atlas Industries':`Customer ${String(c).padStart(3,'0')}`,region,segment,product:p===0?'Platform':'Analytics',actual_cents:actual,budget_cents:budget,cogs_cents:Math.round(actual*costRate),budget_cogs_cents:Math.round(budget*(p===0?0.20:0.29))});
    }
  }
  return rows;
}
export const data=generateData();
