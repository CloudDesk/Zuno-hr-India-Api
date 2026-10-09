import { PdfEmployee, pdfNumber } from './consolidated-tax-pdf-calculation';
import { renderPayslipPdf } from './payslip-pdf-runtime';

export interface ConsolidatedPdfData { financialYear: string; employer: { name: string; address: string }; generatedAt: string; employees: PdfEmployee[]; }
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const amount = (value: unknown): string => pdfNumber(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string): string => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : '-';
const capitalized = (value: string): string => value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
const firstCapital = (value: string): string => value.replace(/^(\s*)(\S)/, (_match, space, letter) => space + letter.toUpperCase());
const declarationLabel = (value: string): string => value.includes('_') || /^[a-z]+$/.test(value)
    ? value.replace(/_/g, ' ').split(/\s+/).map(word => /^(epf|pf|nps|ppf|elss)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : value;
const table = (headers: string[], rows: string[][], className = ''): string => `<table class="${className}"><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index ? ' class="number"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const line = (label: string, value: number): string => `<div class="total-line"><span class="total-label">${escape(label)}</span><span class="total-leader" aria-hidden="true"></span><span class="total-value">${amount(value)}</span></div>`;
function monthly(employee: PdfEmployee, rows: Array<[string, string]>): string {
    return table(['Pay items', 'Total', ...employee.months.map(m => m.label)], rows.map(([label, key]) => {
        const values = employee.months.map(m => Number((m as unknown as Record<string, unknown>)[key] || 0));
        return [escape(label), amount(values.reduce((sum, value) => sum + value, 0)), ...values.map(amount)];
    }), 'monthly');
}
function header(data: ConsolidatedPdfData, employee: PdfEmployee, continued = false): string {
    return `<header><div class="company">${escape(data.employer.name)}</div><div>${escape(data.employer.address)}</div><h1>Income Tax Computation For The Financial Year ${escape(data.financialYear)}</h1><div>Statement as of March ${escape(data.financialYear.slice(5))}${continued ? ' - Continued' : ''}</div></header>
    <table class="identity"><tbody><tr><td>Employee No.</td><td>${escape(employee.code)}</td><td>Name</td><td colspan="3">${escape(firstCapital(employee.name))}</td><td>Location</td><td>${escape(firstCapital(employee.location))}</td></tr>
    ${continued ? '' : `<tr><td>Date of Join</td><td>${date(employee.joined)}</td><td>Gender</td><td>${escape(capitalized(employee.gender))}</td><td>Date of Leaving</td><td>${date(employee.left)}</td><td>Residential Status</td><td>${escape(employee.residentialStatus)}</td></tr><tr><td>PAN No.</td><td>${escape(employee.pan)}</td><td>Date of Birth</td><td>${date(employee.birth)}</td><td>Age</td><td>${escape(employee.age)}</td><td>Tax Regime</td><td>${escape(employee.regime)}</td></tr>`}</tbody></table>`;
}
export function consolidatedPdfHtml(data: ConsolidatedPdfData): string {
    const sheets = data.employees.map(employee => {
        const old = employee.regime === 'OLD';
        const first = `<section class="sheet">${header(data, employee)}
        <h2>A) Taxable Income - Monthly Income</h2>${monthly(employee, [['BASIC', 'basic'], ['HRA', 'hra'], ['OTHER ALLOWANCE', 'allowance'], ['Total', 'gross']])}
        <h2>B) Payroll Deductions</h2>${monthly(employee, [['Provident Fund (PF)', 'pf'], ['Professional Tax (PT)', 'pt'], ['Income Tax (IT)', 'it'], ['Total', 'deductionsTotal']])}
        <h2>C) Perquisites</h2>${table(['Pay items', 'Total', ...employee.months.map(m => m.label)], [['Total', ...Array(13).fill('0.00')]], 'monthly')}
        ${line('D) Gross Salary (A + C)', employee.gross)}
        </section>`;
        const second = `<section class="sheet"><h2>E) Less Exemption under Section 10</h2>
        ${old ? table(['HRA comparison (annual)', 'Amount'], [
            ['HRA Received', amount(employee.hraReceived)], ['Basic + DA', amount(employee.basic)], ['40% / 50% of Basic + DA based on location', amount(employee.hraComparison)],
            ['Rent Paid (Annual)', amount(employee.rent)],
            ['Rent Paid less 10% of Basic + DA (minimum zero)', amount(employee.rentLessBasic)], ['Approved HRA Exemption used in report', amount(employee.hraExemption)],
        ], 'narrow') : ''}
        ${table(['Item', 'Exemption'], [['House Rent Allowance: Section 10(13A)', amount(employee.hraExemption)], ['Leave Travel Assistance: Section 10(5)', '0.00'], ['Education Exemption', '0.00'], ['Total Exemptions', amount(employee.hraExemption)]], 'narrow')}
        <h2>F) Income from Previous Employer - Form 12B</h2>${table(['Pay items', 'Amount'], [['Total Income', amount(employee.previousIncome)], ['Income Tax', amount(employee.previousIT)], ['Professional Tax', amount(employee.previousPT)], ['Provident Fund', amount(employee.previousPF)], ['Previous Cess (4% of Previous Income Tax)', amount(employee.previousCess)]], 'narrow')}
        ${line('G) Income After Exemption (D - E + Previous Income)', employee.afterExemption)}
        ${line('H) Deduction Under Section 16', employee.section16)}
        ${table(['Description', 'Amount'], [['Tax on Employment: Section 16(iii)', amount(employee.pt)], ['Standard Deduction: Section 16(ia)', amount(employee.standard)]], 'narrow')}</section>`;
        const third = `<section class="sheet">
        ${line('I) Income Chargeable under the Head Salaries (G - H)', employee.salaryIncome)}
        ${line('J) Other Income / Loss from House Property', employee.otherIncome)}
        ${line('K) Gross Total Income (I + J)', employee.gti)}
        <h2>L) Deduction under Chapter VI-A</h2>${table(['Investment', 'Section', 'Gross', 'Qualifying', 'Deductible'], [
            ...employee.deductions.map(d => [escape(declarationLabel(d.name)), escape(d.section), amount(d.gross), amount(d.approved), amount(d.approved)]),
            ['Sub Total', '', amount(employee.deductions.reduce((sum, d) => sum + d.gross, 0)), amount(employee.chapterVIA), amount(employee.chapterVIA)],
        ], 'chapter')}
        ${line('M) Taxable Income (K - L)', employee.taxable)}
        ${line('N) Total Tax to be Paid - Final Tax Payable', employee.totalTax)}
        ${table(['Income Tax (Net Tax after Rebate)', 'Surcharge', 'Health & Education Cess', 'Total (Final Tax Payable)'], [[amount(employee.incomeTax), '0.00', amount(employee.cess), amount(employee.totalTax)]], 'tax')}
        </section>`;
        return first + second + third;
    }).join('');
    return `<!doctype html><html><head><meta charset="UTF-8"><style>
    @page { size: A4 landscape; margin: 10mm 10mm 15mm; }
    * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; color: #111; font-size: 9pt; }
    .sheet { break-before: page; } .sheet:first-child { break-before: auto; }
    header { text-align: center; font-size: 9pt; margin-bottom: 5mm; line-height: 1.4; }
    .company { font-size: 12pt; } h1 { font-size: 11pt; font-weight: 500; margin: 1mm 0; }
    h2 { font-size: 9pt; font-weight: 600; margin: 4mm 0 1.5mm; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-bottom: 2mm; }
    th, td { border: .6pt solid #333; padding: 1.2mm; vertical-align: middle; overflow-wrap: anywhere; }
    th { font-weight: 600; background: #f3f5f7; } .number { text-align: right; font-variant-numeric: tabular-nums; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    .monthly { font-size: 7.3pt; } .monthly th:first-child, .monthly td:first-child { width: 15%; text-align: left; }
    .monthly tbody tr:last-child, .chapter tbody tr:last-child { font-weight: 600; background: #f8f8f8; }
    .identity { font-size: 8.5pt; margin-bottom: 6mm; } .identity td:nth-child(2n+1) { width: 11%; background: #f8f8f8; }
    .narrow { width: 65%; break-inside: avoid; } .narrow th, .narrow td { padding: .65mm 1.2mm; font-size: 8.5pt; } .narrow th:first-child { width: 75%; text-align: left; }
    .total-line { display: flex; align-items: baseline; width: 65%; gap: 3mm; margin: 4mm 0; break-inside: avoid; }
    .total-label { flex: 0 1 auto; } .total-leader { flex: 1 1 15mm; max-width: 30mm; border-bottom: 1px dotted #888; }
    .total-value { margin-left: auto; min-width: 30mm; text-align: right; }
    .chapter { width: 65%; font-size: 8.5pt; } .chapter th, .chapter td { padding: .65mm 1.2mm; }
    .chapter th:first-child { width: 45%; text-align: left; }
    .chapter th:nth-child(2) { width: 9%; } .chapter td:nth-child(2) { text-align: center; }
    .tax { width: 80%; margin-top: 3mm; } .tax td { text-align: right; }
    </style></head><body>${sheets}</body></html>`;
}
export async function renderConsolidatedTaxPdf(data: ConsolidatedPdfData, outputPath: string): Promise<void> {
    const generated = new Date(data.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: true });
    await renderPayslipPdf({
        logContext: { userId: 'consolidated-tax-pdf', month: 0, year: Number(data.financialYear.slice(0, 4)) }, outputPath,
        pdfTimeoutMs: 180000,
        renderPage: async page => {
            await page.setContent(consolidatedPdfHtml(data), { waitUntil: 'domcontentloaded' });
            await page.emulateMediaType('print');
            return { format: 'A4', landscape: true, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
                headerTemplate: '<span></span>', footerTemplate: `<div style="width:100%;font-size:8px;padding:0 38px;display:flex;justify-content:space-between;font-family:Arial"><span>Created on: ${escape(generated)} (India time)</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
                margin: { top: '10mm', right: '10mm', bottom: '15mm', left: '10mm' }, timeout: 180000 };
        },
    });
}
