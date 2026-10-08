import { buildPdfEmployee, pdfNumber } from '../src/services/consolidated-tax-pdf-calculation';
import { declaration, employee, salary, fy, clone } from './helpers/consolidated-pdf-fixture';
function calculate(d: any = clone(declaration), user: any = clone(employee), salaries: any[] = [clone(salary)], payrolls: any[] = [], forms: any[] = []) {
 return buildPdfEmployee(user, d, salaries, payrolls, forms, 'ABCDE1234F', fy);
}
describe('PDF calculation: positive and negative cases', () => {
 it('implements every old-regime A–M formula with signed property loss', () => {
  const r = calculate(); expect(r.months).toHaveLength(12);
  expect(r.months[0]).toMatchObject({ gross: 200000, basic: 80000, hra: 40000, allowance: 80000 });
  expect(r).toMatchObject({ gross: 2400000, basic: 960000, hraReceived: 480000, hraExemption: 280000, afterExemption: 2120000,
    standard: 50000, pt: 2500, section16: 52500, salaryIncome: 2067500, otherIncome: -200000, gti: 1867500, chapterVIA: 180000, taxable: 1687500 });
  expect(r.afterExemption).toBe(r.gross-r.hraExemption+r.previousIncome); expect(r.salaryIncome).toBe(r.afterExemption-r.section16);
  expect(r.gti).toBe(r.salaryIncome+r.otherIncome); expect(r.taxable).toBe(r.gti-r.chapterVIA);
 });
 it('uses the stored FY summary exactly for N without rebating or adding cess again', () => {
  const r=calculate(); expect(r).toMatchObject({ incomeTax:50250,cess:2010,totalTax:52260 });
  expect(r.warnings.join(' ')).toContain('differs from the stored FY summary');
 });
 it('preserves final payable after Form12B credit even when it differs from net tax plus cess', () => {
  const d=clone(declaration); d.initialTaxBreakdown.finalTaxWithCess=42260;
  expect(calculate(d)).toMatchObject({incomeTax:50250,cess:2010,totalTax:42260});
 });
 it('includes zero-tax employees with all N values zero', () => {
  const d=clone(declaration); d.initialTaxBreakdown={totalTaxAmount:0,cessAmount:0,finalTaxWithCess:0};
  expect(calculate(d)).toMatchObject({incomeTax:0,cess:0,totalTax:0});
 });
 it('applies the new-regime display rules and 75000 standard deduction', () => {
  const r=calculate({...clone(declaration),regime:'new'});
  expect(r).toMatchObject({ hraExemption:0,pt:0,standard:75000,section16:75000,otherIncome:0,chapterVIA:0,afterExemption:2400000,salaryIncome:2325000,taxable:2325000 });
  expect(r.deductions).toEqual([]);
 });
 it.each(['pending','rejected','document_submitted','resubmission_requested'])('excludes %s amounts from exemptions, property and Chapter VI-A', status=>{
  const d=clone(declaration); d.declarations.forEach((item:any)=>item.status=status);
  const r=calculate(d); expect(r).toMatchObject({hraExemption:0,otherIncome:0,chapterVIA:0});
  expect(r.deductions.every(item=>item.approved===0)).toBe(true);
 });
 it('uses approved amount rather than declared amount and respects per-item limits',()=>{
  const d=clone(declaration);d.declarations=[{section:'80C',status:'verified',declaredAmount:500000,verifiedAmount:180000,maxLimit:150000}];
  expect(calculate(d).chapterVIA).toBe(150000);
 });
 it('excludes non-Chapter-VI-A sections such as LTA from Chapter VI-A',()=>{
  const d=clone(declaration);d.declarations=[{section:'10(5)',status:'verified',verifiedAmount:50000},{section:'80CCD(2)',status:'verified',verifiedAmount:25000}];
  expect(calculate(d).chapterVIA).toBe(25000);
 });
 it.each([['income',200000],['loss',-200000]])('handles approved property %s', (type,expected)=>{
  const d=clone(declaration);d.declarations=[{section:'24(b)',type,status:'verified',verifiedAmount:200000}];
  const r=calculate(d);expect(r.otherIncome).toBe(expected);expect(r.gti).toBe(r.salaryIncome+Number(expected));
 });
 it('does not infer the sign of an untyped property entry',()=>{
  const d=clone(declaration);d.declarations=[{section:'24B',status:'verified',verifiedAmount:200000}];
  expect(calculate(d).otherIncome).toBe(0);expect(calculate(d).warnings.join(' ')).toContain('income/loss type');
 });
 it('adds verified previous employer income and splits previous TDS with 4% cess',()=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[],[{status:'Verified',salaryEarned:300000,tdsDeducted:120000,previousPF:18000,professionalTax:1250}]);
  expect(r).toMatchObject({previousIncome:300000,previousIT:115384.62,previousCess:4615.38,previousPF:18000,previousPT:1250,afterExemption:2420000});
 });
 it.each([[],[undefined],[{status:'Pending',salaryEarned:300000}],[{status:'Verified',salaryEarned:300000},{status:'Verified',salaryEarned:300000}]].map(forms=>({forms})))('zeroes missing, incomplete, unverified or ambiguous Form12B: %p', ({forms})=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[],forms);
  expect(r).toMatchObject({previousIncome:0,previousIT:0,previousPF:0,previousPT:0,previousCess:0});
 });
 it.each([[], [{status:'Pending',salaryEarned:300000}]].map(forms=>({forms})))('does not gate current values on missing or pending Form12B: %p', ({forms})=>{
  const payroll=[{year:2026,month:4,status:'Processed',epfEmployee:3000,professionalTax:200,incomeTax:5000}];
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],payroll,forms);
  expect(r.months[0]).toMatchObject({gross:200000,basic:80000,hra:40000,allowance:80000,pf:3000,pt:200,it:5000,deductionsTotal:8200});
  expect(r).toMatchObject({gross:2400000,hraExemption:280000,otherIncome:-200000,chapterVIA:180000,incomeTax:50250,cess:2010,totalTax:52260,previousIncome:0,previousIT:0,previousPF:0,previousPT:0,previousCess:0});
 });
 it('does not include previous PT under the new regime',()=>{
  const r=calculate({...clone(declaration),regime:'new'},clone(employee),[clone(salary)],[],[{status:'Verified',salaryEarned:300000,professionalTax:1250}]);
  expect(r.previousPT).toBe(0);expect(r.previousIncome).toBe(300000);
 });
 it('includes employees with no declaration while retaining independently available salary',()=>{
  const r=calculate(null);expect(r.gross).toBe(2400000);expect(r).toMatchObject({regime:'-',incomeTax:0,cess:0,totalTax:0,chapterVIA:0});
 });
 it('retains employees with no salary assignments',()=>{const r=calculate(clone(declaration),clone(employee),[]);expect(r.gross).toBe(0);expect(r.incomeTax).toBe(50250);});
 it.each([-1,NaN,Infinity,undefined,'50250'])('does not emit invalid numeric tax values: %p', invalid=>{
  const d=clone(declaration);d.initialTaxBreakdown={totalTaxAmount:invalid,cessAmount:invalid,finalTaxWithCess:invalid};
  expect(calculate(d)).toMatchObject({incomeTax:0,cess:0,totalTax:0});
 });
 it('retains a positive migrated final liability',()=>{
  const d=clone(declaration);d.isMigrationAdjusted=true;d.migrationAdjustment={totalMigratedTaxLiability:120000};
  expect(calculate(d).totalTax).toBe(120000);
 });
 it('flags a missing final summary value without fabricating tax payable',()=>{
  const d=clone(declaration);delete d.initialTaxBreakdown.finalTaxWithCess;
  const r=calculate(d);expect(r.totalTax).toBe(0);expect(r.incomeTax).toBe(50250);expect(r.warnings.join(' ')).toContain('Final Tax Payable is unavailable');
 });
 it('handles malformed declaration lists without dropping the employee',()=>{
  const r=calculate({...clone(declaration),declarations:null});expect(r.chapterVIA).toBe(0);expect(r.incomeTax).toBe(50250);
 });
 it('changes salary rate at an FY revision',()=>{
  const r=calculate(clone(declaration),clone(employee),[{...clone(salary),effectiveTo:'2026-09-30',monthlyGross:100000},{...clone(salary),effectiveFrom:'2026-10-01'}]);
  expect(r.gross).toBe(1800000);expect(r.months[5].gross).toBe(100000);expect(r.months[6].gross).toBe(200000);
 });
 it('prorates joining and leaving dates',()=>{
  const r=calculate(clone(declaration),{...clone(employee),joiningDate:'2026-04-16',separationDate:'2026-04-30'});
  expect(r.gross).toBe(100000);expect(r.months.slice(1).every(m=>m.gross===0)).toBe(true);
 });
 it.each(['2026-07-15','2026-07-15T00:00:00+05:30'])('handles the July 15 leaving-date example without changing stored tax: %s', separationDate=>{
  const d=clone(declaration),u={...clone(employee),separationDate},s={...clone(salary),monthlyGross:100000};
  const original=JSON.stringify({d,u,s});const r=calculate(d,u,[s]);
  expect(r.months.slice(0,3).map(m=>m.gross)).toEqual([100000,100000,100000]);
  expect(r.months[3]).toMatchObject({gross:48387.10,basic:19354.84,hra:9677.42,allowance:19354.84});
  expect(r.months.slice(4).every(m=>m.gross===0&&m.basic===0&&m.hra===0&&m.allowance===0)).toBe(true);
  expect(r.gross).toBe(348387.10);expect(r.left).toBe('2026-07-15');
  expect(r).toMatchObject({incomeTax:50250,cess:2010,totalTax:52260});
  expect(JSON.stringify({d,u,s})).toBe(original);
 });
 it.each([{left:'2026-04-01',gross:3333.33},{left:'2027-03-31',gross:1200000}])('includes the separation day at the FY boundary: %p', ({left,gross})=>{
  const r=calculate(clone(declaration),{...clone(employee),separationDate:left},[{...clone(salary),monthlyGross:100000}]);expect(r.gross).toBe(gross);
 });
 it('uses India calendar dates for timestamps with an India offset',()=>{
  const r=calculate(clone(declaration),{...clone(employee),joiningDate:'2026-04-01T00:00:00+05:30',separationDate:'2026-04-30T00:00:00+05:30'},[{...clone(salary),effectiveFrom:'2026-04-01T00:00:00+05:30'}]);
  expect(r.joined).toBe('2026-04-01');expect(r.left).toBe('2026-04-30');expect(r.gross).toBe(200000);
 });
 it.each(['invalid','2027-04-01'])('handles invalid or out-of-FY employment start %s', joiningDate=>{
  const r=calculate(clone(declaration),{...clone(employee),joiningDate});expect(r.gross).toBe(0);
 });
 it('does not project malformed salary dates',()=>{
  const r=calculate(clone(declaration),clone(employee),[{...clone(salary),effectiveFrom:'invalid'}]);expect(r.gross).toBe(0);expect(r.warnings.join(' ')).toContain('Invalid salary assignments');
 });
 it('excludes negative salary rates',()=>{expect(calculate(clone(declaration),clone(employee),[{...clone(salary),monthlyGross:-1}]).gross).toBe(0);});
 it('zeroes overlapping months and flags the overlap',()=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary),clone(salary)]);expect(r.gross).toBe(0);expect(r.warnings.join(' ')).toContain('Overlapping salary');
 });
 it('projects gaps from an available salary rate with a review note',()=>{
  const r=calculate(clone(declaration),clone(employee),[{...clone(salary),effectiveFrom:'2026-09-01'}]);expect(r.gross).toBe(2400000);expect(r.warnings.join(' ')).toContain('nearest recorded');
 });
 it('preserves stored annual PT when slabs are empty and payroll exists',()=>{
  const s=clone(salary);s.salaryStructureId.statutoryDeductions.professionalTax.slabs=[];
  expect(calculate(clone(declaration),clone(employee),[s],[{year:2026,month:4,epfEmployee:3000}]).pt).toBe(2500);
 });
 it('uses payroll PT when both slab and declaration PT are unavailable',()=>{
  const s=clone(salary);s.salaryStructureId.statutoryDeductions.professionalTax.slabs=[];
  const d=clone(declaration);delete d.ptDeduction;
  expect(calculate(d,clone(employee),[s],[{year:2026,month:4,professionalTax:1250}]).pt).toBe(1250);
 });
 it('uses latest regular payroll and sums final-settlement deductions separately',()=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[
   {year:2026,month:4,processedAt:'2026-04-01',epfEmployee:1000,professionalTax:100,incomeTax:100},
   {year:2026,month:4,processedAt:'2026-04-30',epfEmployee:3000,professionalTax:1250,incomeTax:4000},
   {year:2026,month:4,type:'FinalSettlement',epfEmployee:500,professionalTax:0,incomeTax:1000},
   {year:2026,month:4,status:'Cancelled',epfEmployee:9000,incomeTax:9000},
  ]);expect(r.months[0]).toMatchObject({pf:3500,pt:1250,it:5000,deductionsTotal:9750});
 });
 it('does not permit negative taxable income',()=>{
  const d=clone(declaration);d.declarations=[{section:'80C',status:'verified',verifiedAmount:9999999}];expect(calculate(d).taxable).toBe(0);
 });
 it.each(['2026-2026','bad','2026-2028'])('rejects invalid FY %s', year=>{expect(()=>buildPdfEmployee(employee,declaration,[salary],[],[],'',year)).toThrow();});
 it('uses the India calendar boundary for PT on a one-day employment period',()=>{
  const d=clone(declaration);delete d.ptDeduction;
  const r=calculate(d,{...clone(employee),joiningDate:'2026-04-01T00:00:00+05:30',separationDate:'2026-04-01T00:00:00+05:30'},[clone(salary)]);
  expect(r.pt).toBe(1250);
 });
 it('does not mutate source data',()=>{
  const d=clone(declaration),s=clone(salary),u=clone(employee);const before=JSON.stringify({d,s,u});calculate(d,u,[s]);expect(JSON.stringify({d,s,u})).toBe(before);
 });
 it.each([undefined,null,NaN,Infinity,'12'])('formats invalid numeric values as zero: %p', value=>{expect(pdfNumber(value)).toBe(0);});
});
