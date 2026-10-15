import { consolidatedPdfHtml, renderConsolidatedTaxPdf } from '../src/services/consolidated-tax-pdf-renderer';
import { buildPdfEmployee } from '../src/services/consolidated-tax-pdf-calculation';
import { renderPayslipPdf } from '../src/services/payslip-pdf-runtime';
import { fy, employee, salary, declaration, payrolls, clone } from './helpers/consolidated-pdf-fixture';
jest.mock('../src/services/payslip-pdf-runtime',()=>({renderPayslipPdf:jest.fn()}));
const data=()=>({financialYear:fy,generatedAt:'2026-10-08T10:00:00Z',employer:{name:'Employer Name',address:'Organisation Office Address'},employees:[buildPdfEmployee(employee,clone(declaration),[salary],clone(payrolls),[],'ABCDE1234F',fy)]});
it.each([['name test','chennai','Name test','Chennai'],['mCdonald Raj','new Delhi','MCdonald Raj','New Delhi'],['','-','','-']])('capitalizes the first letter of name and location without changing stored values', (name,location,expectedName,expectedLocation)=>{
 const d=data();d.employees[0].name=name;d.employees[0].location=location;const original=JSON.stringify(d);
 const html=consolidatedPdfHtml(d);
 expect(html).toContain(`<td>Name</td><td colspan="3">${expectedName}</td><td>Location</td><td>${expectedLocation}</td>`);
 expect(JSON.stringify(d)).toBe(original);
});
it.each([840000,0])('displays annual rent paid %s without altering the HRA exemption',rent=>{
 const d=data();d.employees[0].rent=rent;const original=JSON.stringify(d);
 const html=consolidatedPdfHtml(d);
 expect(html).toContain(`<td>Rent Paid (Annual)</td><td class="number">${rent ? '8,40,000.00' : '0.00'}</td>`);
 expect(html).toMatch(/<td>40% \/ 50% of Basic \+ DA based on location<\/td><td class="number">[^<]+<\/td><\/tr><tr><td>Rent Paid \(Annual\)<\/td>/);
 expect(html).toContain(`<td>Approved HRA Exemption used in report</td><td class="number">${d.employees[0].hraExemption.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`);
 expect(JSON.stringify(d)).toBe(original);
});
it('renders Section L with five columns and subtotal without changing calculations',()=>{
 const d=data();const person=d.employees[0];
 person.deductions=[{name:'epf',section:'80C',gross:12753,approved:0},{name:'life_insurance',section:'80C',gross:160000,approved:150000}];person.chapterVIA=150000;
 const original=JSON.stringify(d);const html=consolidatedPdfHtml(d);const chapter=html.match(/<table class="chapter">[\s\S]*?<\/table>/)![0];
 expect(chapter).toContain('<th>Investment</th><th>Section</th><th>Gross</th><th>Qualifying</th><th>Deductible</th>');
 expect(chapter).toContain('<td>EPF</td><td class="number">80C</td><td class="number">12,753.00</td><td class="number">0.00</td><td class="number">0.00</td>');
 expect(chapter).toContain('<td>Life Insurance</td><td class="number">80C</td><td class="number">1,60,000.00</td><td class="number">1,50,000.00</td><td class="number">1,50,000.00</td>');
 expect(chapter).toContain('<td>Sub Total</td><td class="number"></td><td class="number">1,72,753.00</td><td class="number">1,50,000.00</td><td class="number">1,50,000.00</td>');
 expect(JSON.stringify(d)).toBe(original);
});
it('renders five-column zero subtotals when no Chapter VI-A deductions apply',()=>{
 const d=data();d.employees=[buildPdfEmployee(employee,{...clone(declaration),regime:'new'},[salary],[],[],'',fy)];
 const chapter=consolidatedPdfHtml(d).match(/<table class="chapter">[\s\S]*?<\/table>/)![0];
 expect(chapter).toContain('<td>Sub Total</td><td class="number"></td><td class="number">0.00</td><td class="number">0.00</td><td class="number">0.00</td>');
});
it('omits source review notes from the PDF while preserving values and internal notes',()=>{
 const d=data();d.employees[0].warnings=['Internal source review note'];
 const html=consolidatedPdfHtml(d);
 expect(html).not.toContain('Source review:');expect(html).not.toContain('Internal source review note');
 expect(html).toContain('52,260.00');expect(d.employees[0].warnings).toEqual(['Internal source review note']);
});
it('prints company and employee identity only once for each employee',()=>{
 const d=data();d.employees.push({...d.employees[0],id:'2',code:'CD0002',name:'Employee Two'});
 const html=consolidatedPdfHtml(d);expect(html.match(/<header>/g)).toHaveLength(2);expect(html.match(/class="identity"/g)).toHaveLength(2);expect(html.match(/class="sheet"/g)).toHaveLength(6);
 const sheets=html.split('<section class="sheet">').slice(1);expect(sheets[0]).toContain('<header>');expect(sheets[1]).not.toContain('<header>');expect(sheets[2]).not.toContain('<header>');expect(sheets[3]).toContain('Employee Two');
});
it('formats declaration keys as readable labels without changing source values',()=>{
 const d=data();d.employees[0].deductions[0].name='housing_loan_principal';d.employees[0].deductions[1].name='epf';
 const html=consolidatedPdfHtml(d);
 expect(html).toContain('Housing Loan Principal');expect(html).toContain('EPF');expect(html).not.toContain('housing_loan_principal');
 expect(html).toContain('class="chapter"');expect(d.employees[0].deductions[0].name).toBe('housing_loan_principal');
});
it('shows Section N tax values exactly and stops after N',()=>{
 const html=consolidatedPdfHtml(data());expect(html).toContain('50,250.00');expect(html).toContain('2,010.00');expect(html).toContain('52,260.00');
 for(const label of ['O) Tax Paid','P) Relief','Q) Annual','R) TDS','S) Balance','Section 87A Rebate','Monthly Rent','J(a)','J(b)'])expect(html).not.toContain(label);
 expect(html).toContain('N) Total Tax to be Paid');
});
it('displays zero for an employee with no tax summary',()=>{
 const d=data();d.employees=[buildPdfEmployee(employee,undefined,[salary],[],[],'',fy)];const html=consolidatedPdfHtml(d);
 const tax=html.split('class="tax"')[1];expect(tax).toContain('0.00');expect(tax).not.toContain('undefined');expect(tax).not.toContain('NaN');
});
it('does not show old-regime comparison or declaration rows for the new regime',()=>{
 const d=data();d.employees=[buildPdfEmployee(employee,{...clone(declaration),regime:'new'},[salary],[],[],'',fy)];const html=consolidatedPdfHtml(d);
 expect(html).not.toContain('HRA comparison');expect(html).not.toContain('Life Insurance');expect(html).toContain('L) Deduction under Chapter VI-A');
});
it('escapes all employee, company, address and declaration content',()=>{
 const d=data();d.employer.name='<script>alert(1)</script>';d.employer.address='A & B';d.employees[0].name='<img onerror="bad">';d.employees[0].deductions[0].name='<b>bad</b>';
 const html=consolidatedPdfHtml(d);expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('&lt;script&gt;');expect(html).toContain('A &amp; B');expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
});
it('uses the existing runtime once with India timestamp, footer page counts and extended PDF timeout',async()=>{
 await renderConsolidatedTaxPdf(data(),'sample.pdf');expect(renderPayslipPdf).toHaveBeenCalledTimes(1);
 const args=jest.mocked(renderPayslipPdf).mock.calls[0][0];expect(args.pdfTimeoutMs).toBe(180000);
 const page:any={setContent:jest.fn().mockResolvedValue(undefined),emulateMediaType:jest.fn().mockResolvedValue(undefined)};
 const options=await args.renderPage(page);expect(options).toMatchObject({landscape:true,displayHeaderFooter:true,timeout:180000});
 expect(options.footerTemplate).toContain('pageNumber');expect(options.footerTemplate).toContain('totalPages');expect(options.footerTemplate).toContain('India time');expect(options.footerTemplate).toContain('3:30:00');
 expect(page.setContent).toHaveBeenCalledWith(expect.any(String),{waitUntil:'domcontentloaded'});
});

it('shows optional actual payroll components separately and hides empty rows',()=>{
 const d=data();const p={...clone(payrolls[0]),basic:53333,hra:26667,otherAllowance:53333.33,da:1000,travelAllowance:500,airTicketAllowance:300,medicalAllowance:200,reimbursementAllowance:400};
 d.employees=[buildPdfEmployee(employee,clone(declaration),[salary],[p],[],'',fy)];
 const html=consolidatedPdfHtml(d);for(const label of ['DA','TRAVEL ALLOWANCE','AIR TICKET ALLOWANCE','MEDICAL ALLOWANCE','REIMBURSEMENT ALLOWANCE'])expect(html).toContain(`<td>${label}</td>`);
 expect(html).toContain('53,333.00');expect(html).toContain('26,667.00');expect(html).toContain('53,333.33');expect(html).toContain('1,35,733.33');
 expect(consolidatedPdfHtml(data())).not.toContain('<td>DA</td>');
});
