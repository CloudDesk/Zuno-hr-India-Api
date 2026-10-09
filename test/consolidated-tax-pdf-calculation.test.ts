import { buildPdfEmployee, pdfNumber } from '../src/services/consolidated-tax-pdf-calculation';
import { declaration, employee, salary, payrolls as storedPayrolls, fy, clone } from './helpers/consolidated-pdf-fixture';
function calculate(d: any = clone(declaration), user: any = clone(employee), salaries: any[] = [clone(salary)], payrolls: any[] = clone(storedPayrolls), forms: any[] = []) {
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
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],clone(storedPayrolls),[{status:'Verified',salaryEarned:300000,tdsDeducted:120000,previousPF:18000,professionalTax:1250}]);
  expect(r).toMatchObject({previousIncome:300000,previousIT:115384.62,previousCess:4615.38,previousPF:18000,previousPT:1250,afterExemption:2420000});
 });
 it.each([[],[undefined],[{status:'Pending',salaryEarned:300000}],[{status:'Verified',salaryEarned:300000},{status:'Verified',salaryEarned:300000}]].map(forms=>({forms})))('zeroes missing, incomplete, unverified or ambiguous Form12B: %p', ({forms})=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[],forms);
  expect(r).toMatchObject({previousIncome:0,previousIT:0,previousPF:0,previousPT:0,previousCess:0});
 });
 it.each([[], [{status:'Pending',salaryEarned:300000}]].map(forms=>({forms})))('does not gate current values on missing or pending Form12B: %p', ({forms})=>{
  const payroll=clone(storedPayrolls); Object.assign(payroll[0],{epfEmployee:3000,professionalTax:200,incomeTax:5000});
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
 it('retains employees with no salary assignments',()=>{const r=calculate(clone(declaration),clone(employee),[]);expect(r.gross).toBe(2400000);expect(r.incomeTax).toBe(50250);});
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
 it('uses actual attendance-adjusted components without applying payable days twice',()=>{
  const p={...clone(storedPayrolls[0]),basic:53333,hra:26667,otherAllowance:53333.33,monthlyGross:200000,payableDays:20,presentDays:18,totalDaysInMonth:30,assigned:{basic:80000,hra:40000,otherAllowance:80000}};
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[p]);
  expect(r.months[0]).toMatchObject({basic:53333,hra:26667,allowance:53333.33,gross:133333.33});expect(r.gross).toBe(133333.33);
  expect(r.months.slice(1).every(m=>m.gross===0)).toBe(true);
 });
 it('shows zero without payroll even when a salary assignment exists',()=>{
  const r=calculate(clone(declaration),clone(employee),[clone(salary)],[]);
  expect(r.gross).toBe(0);expect(r.months.every(m=>m.basic===0&&m.hra===0&&m.allowance===0)).toBe(true);
  expect(r.warnings.join(' ')).toContain('No payroll');expect(r.totalTax).toBe(52260);
 });
 it('uses payroll amounts without imposing salary component percentages',()=>{
  const r=calculate(null,clone(employee),[],[{...clone(storedPayrolls[0]),basic:50000,hra:10000,otherAllowance:5000,da:2000,travelAllowance:1000,airTicketAllowance:300,medicalAllowance:200,reimbursementAllowance:500}]);
  expect(r.months[0]).toMatchObject({basic:50000,hra:10000,allowance:5000,gross:69000});expect(r.basic).toBe(52000);
 });
 it.each([-1,NaN,Infinity,undefined,'80000'])('zeroes invalid payroll earnings without changing deductions: %p',invalid=>{
  const r=calculate(null,clone(employee),[],[{...clone(storedPayrolls[0]),basic:invalid,epfEmployee:3000}]);
  expect(r.gross).toBe(0);expect(r.months[0].pf).toBe(3000);expect(r.warnings.join(' ')).toContain('Invalid payroll earnings');
 });
 it('accepts zero earnings and absent optional components',()=>{
  const r=calculate(null,clone(employee),[],[{year:2026,month:4,basic:0,hra:0,otherAllowance:0,payableDays:0}]);
  expect(r.gross).toBe(0);expect(r.warnings.join(' ')).not.toContain('Invalid payroll earnings');
 });
 it('rejects invalid optional payroll components',()=>{
  expect(calculate(null,clone(employee),[],[{...clone(storedPayrolls[0]),da:-1}]).gross).toBe(0);
 });
 it('shows zero before the first available September payroll',()=>{
  const r=calculate(clone(declaration),clone(employee),[{...clone(salary),effectiveFrom:'2026-09-22'}],clone(storedPayrolls.slice(5)));
  expect(r.months.slice(0,5).map(m=>m.gross)).toEqual(Array(5).fill(0));expect(r.gross).toBe(1400000);
 });
 it('uses salary revisions as recorded by payroll',()=>{
  const p=clone(storedPayrolls);p.slice(0,6).forEach(m=>{m.basic=40000;m.hra=20000;m.otherAllowance=40000;});
  expect(calculate(clone(declaration),clone(employee),[clone(salary)],p).gross).toBe(1800000);
 });
 it.each(['2026-07-15','2026-07-15T00:00:00+05:30'])('retains actual leaving-month payroll without another date proration: %s',separationDate=>{
  const p=clone(storedPayrolls.slice(0,4));p.forEach(m=>{m.basic=40000;m.hra=20000;m.otherAllowance=40000;});
  Object.assign(p[3],{basic:19355,hra:9677,otherAllowance:19355.10});
  const r=calculate(clone(declaration),{...clone(employee),separationDate},[clone(salary)],p);
  expect(r.gross).toBe(348387.10);expect(r.months[3].gross).toBe(48387.10);expect(r.left).toBe('2026-07-15');expect(r.totalTax).toBe(52260);
  expect(r.months.slice(4).every(m=>m.gross===0)).toBe(true);
 });
 it('retains joining-month payroll without another date proration',()=>{
  const r=calculate(null,{...clone(employee),joiningDate:'2026-09-22'},[],[{...clone(storedPayrolls[5]),basic:24000,hra:12000,otherAllowance:24000}]);
  expect(r.gross).toBe(60000);
 });
 it.each(['invalid','2027-04-01'])('shows zero for invalid or out-of-FY employment start %s',joiningDate=>{
  expect(calculate(null,{...clone(employee),joiningDate}).gross).toBe(0);
 });
 it('uses India calendar employment boundaries',()=>{
  const r=calculate(null,{...clone(employee),joiningDate:'2026-04-01T00:00:00+05:30',separationDate:'2026-04-01T00:00:00+05:30'},[],[{...clone(storedPayrolls[0]),basic:1333,hra:667,otherAllowance:1333.33}]);
  expect(r.gross).toBe(3333.33);expect(r.joined).toBe('2026-04-01');expect(r.left).toBe('2026-04-01');
 });
 it('does not discard actual earnings because salary assignments are malformed or overlap',()=>{
  expect(calculate(null,clone(employee),[{...clone(salary),effectiveFrom:'invalid'}]).gross).toBe(2400000);
  expect(calculate(null,clone(employee),[clone(salary),clone(salary)]).gross).toBe(2400000);
 });
 it('excludes cancelled, failed and other-FY payroll earnings',()=>{
  const p=clone(storedPayrolls[0]);expect(calculate(null,clone(employee),[],[{...p,status:'Cancelled'},{...p,status:'Failed'},{...p,year:2025}]).gross).toBe(0);
 });
 it('uses latest regular payroll plus final settlement earnings once',()=>{
  const p=clone(storedPayrolls[0]);const r=calculate(null,clone(employee),[],[
   {...p,processedAt:'2026-04-01'}, {...p,processedAt:'2026-04-30',basic:40000,hra:20000,otherAllowance:40000},
   {...p,type:'FinalSettlement',basic:4000,hra:2000,otherAllowance:4000}
  ]);expect(r.gross).toBe(110000);expect(r.months[0]).toMatchObject({basic:44000,hra:22000,allowance:44000});
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
