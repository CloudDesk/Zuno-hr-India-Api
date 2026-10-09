export const fy = '2026-2027';
export const payrolls = Array.from({length:12}, (_, offset) => ({employeeId:'employee-1',year:offset<9?2026:2027,month:((offset+3)%12)+1,status:'Completed',type:'Regular',basic:80000,hra:40000,otherAllowance:80000,da:0,travelAllowance:0,reimbursementAllowance:0,epfEmployee:0,professionalTax:0,incomeTax:0}));
export const employee = { _id: 'employee-1', name: 'Test Employee', employeeCode: 'CD0001', location: 'Chennai', gender: 'Female', joiningDate: '2026-04-01', dateOfBirth: '1990-05-01', governmentIds: { pan: { number: 'ABCDE1234F' } } };
export const salary = { employeeId: 'employee-1', effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', monthlyGross: 200000, salaryStructureId: { statutoryDeductions: { professionalTax: { term: 'half_yearly', slabs: [{ fromAmount: 0, toAmount: null, taxAmount: 1250 }] } } } };
export const declaration: any = { employeeId: 'employee-1', regime: 'old', ptDeduction: 2500,
 declarations: [
  { section: '10(13A)', subSection: 'HRA', status: 'verified', declaredAmount: 280000, verifiedAmount: 280000, rentDetails: [{ amount: 840000 }] },
  { section: 'Income/Loss House Property', status: 'verified', type: 'loss', verifiedAmount: 200000 },
  { section: '80C', subSection: 'Life Insurance', status: 'verified', declaredAmount: 150000, verifiedAmount: 150000, maxLimit: 150000 },
  { section: '80D', subSection: 'Health Insurance', status: 'verified', declaredAmount: 30000, verifiedAmount: 30000 },
 ], initialTaxBreakdown: { totalTaxAmount: 50250, cessAmount: 2010, finalTaxWithCess: 52260, taxableIncome: 688750 } };
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
