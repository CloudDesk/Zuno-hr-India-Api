import { isReportEpf, withActualEpf } from '../src/services/consolidated-report-epf';
it('replaces declared EPF with actual 20360 while retaining other deductions',()=>{
 const source=[{name:'epf',section:'80C',gross:21600,approved:21600},{name:'Housing Loan Principal',section:'80C',gross:78400,approved:78400},{name:'National Savings Certificate',section:'80C',gross:50000,approved:50000},{name:'Self Family',section:'80D',gross:25000,approved:25000},{name:'Medical Checkup Parents',section:'80D',gross:5000,approved:5000}];
 const before=JSON.stringify(source);const result=withActualEpf(source,20360);
 expect(result[0]).toMatchObject({name:'EPF',gross:20360,approved:20360});expect(result.slice(1)).toEqual(source.slice(1));expect(result.reduce((sum,item)=>sum+item.approved,0)).toBe(178760);expect(JSON.stringify(source)).toBe(before);
});
it('adds actual EPF without a declaration and excludes duplicate declared EPF',()=>{
 expect(withActualEpf([],20360)).toEqual([{name:'EPF',section:'80C',gross:20360,approved:20360}]);
 const item={name:'EPF',section:'80C',gross:21600,approved:21600};expect(withActualEpf([item,item],20360)).toHaveLength(1);
});
it('retains actual EPF gross while applying the remaining 80C limit',()=>{
 const result=withActualEpf([{name:'Life Insurance',section:'80C',gross:140000,approved:140000}],20360);
 expect(result[1]).toMatchObject({gross:20360,approved:10000});
});
it('does not confuse PPF with employee payroll EPF',()=>{
 expect(isReportEpf({name:'PPF',section:'80C'})).toBe(false);expect(isReportEpf({subSection:'epf',section:'80C'})).toBe(true);
});
it('shows zero actual EPF when payroll deductions are zero',()=>{
 expect(withActualEpf([{name:'EPF',section:'80C',gross:21600,approved:21600}],0)[0]).toMatchObject({gross:0,approved:0});
});
