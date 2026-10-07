import ExcelJS from 'exceljs';
import { exportConsolidatedTaxWorkbook } from '../src/services/consolidated-tax-report.service';
import { buildConsolidatedRow, REPORT_COLUMNS, REPORT_NOTES } from '../src/services/consolidated-tax-calculation';

// Independent fixture captured from reference Sheet1!A5:AJ5.
const EXPECTED_HEADERS = [
    "Sl No",
    "Name",
    "EmployeeNo",
    "PAN Number",
    "JoinDate",
    "LeavingDate",
    "LeftOrg",
    "Current Regime",
    "D) Gross Salary",
    "E) Basic DA Value",
    "E) House Rent Allowance : Section 10(13a)",
    "E) HRA Received",
    "E) Leave Travel Assistance",
    "E) Total Exemptions",
    "E) Total Rent Paid p.a",
    "F) Prev IT",
    "F) Prev PF",
    "F) Prev PT",
    "F) Prev Total Income",
    "G) Income After Exemption",
    "H) Deduction Under Section 16",
    "H) Tax on Employment : Sec 16(iii)",
    "H) Standard Deduction : Sec 16(ia)",
    "I) Income chargeable under the head salaries",
    "J) Other Income",
    "K) Gross Total Income",
    "I) ChapterVIA Deduction",
    "M) Taxable Income",
    "N) Taxable Income Round off to 10 Rs.",
    "O) Total Income Tax to be Paid",
    "O) Total Surcharge to be Paid",
    "O) Total Cess to be Paid",
    "O) Total Tax to be paid",
    "O) Relief u/s 87A"
];

describe('Consolidated tax Excel output', () => {
    it('exports only specification fields in order and excludes legacy columns even with nonzero values', async () => {
        const row = buildConsolidatedRow({ employee: { _id: '1' }, financialYear: '2025-2026', serial: 1, salaries: [],
            declaration: { regime: 'old', annualGross: 0, declarations: [] },
            previous: { status: 'Verified', salaryEarned: 100000, tdsDeducted: 5000, previousPF: 1800, professionalTax: 1250, previousSurcharge: 150 } });
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z',
            employer: { name: 'Example', address: 'Example' }, columns: [...REPORT_COLUMNS, { key: 'directTdsTax', label: 'Direct TDS Income Tax', type: 'money' }], notes: [...REPORT_NOTES],
            rows: [{ ...row, values: { ...row.values, directTdsTax: 1234 } }] });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(sheet.columnCount).toBe(34);
        expect(sheet.getRow(5).values).not.toContain('P) Income Tax Paid');
        expect(sheet.getRow(5).values).not.toContain('E) Excess Rent');
        expect(sheet.getRow(5).values).toEqual([undefined, ...EXPECTED_HEADERS]);
        expect(sheet.getCell('Q6').value).toBe(1800); // Declared previous PF
        expect(sheet.getCell('R6').value).toBe(1250); // Previous PT
        expect(sheet.getCell('P6').value).toBe(4807.69); // Previous TDS income-tax component
        expect(sheet.getCell('I6').value).toBe('-'); // Missing required gross
        expect(sheet.getCell('AG6').value).toBe('-'); // Missing required annual tax
    });
    it('shows numeric zero for missing Form 12B amounts while missing leaving date shows a dash', async () => {
        const row = buildConsolidatedRow({ employee: { _id: '1' }, financialYear: '2025-2026', serial: 1, salaries: [] });
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z',
            employer: { name: 'Example', address: 'Example' }, columns: REPORT_COLUMNS, notes: [...REPORT_NOTES], rows: [row] });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        for (const address of ['P6', 'Q6', 'R6', 'S6']) {
            expect(sheet.getCell(address).value).toBe(0);
            expect(sheet.getCell(address).type).toBe(ExcelJS.ValueType.Number);
        }
        expect(sheet.getCell('F6').value).toBe('-');
    });
    it('preserves template ordering, typed amounts/dates, literal text and review notes', async () => {
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z', employer: { name: 'Example employer', address: 'Example address' },
            columns: REPORT_COLUMNS, notes: [...REPORT_NOTES], rows: [{ employeeId: '1', warnings: ['Missing previous-employer details.'], values: {
                serial: 1, name: '=HYPERLINK("https://example.com")', employeeCode: '00001', joiningDate: '2025-04-01', gross: 1200000.25,
                totalTax: 0, previousIT: 4807.69, previousTax: 4807.69, previousCess: 192.31, taxPaid: 40000, taxBalance: -1250.5, currentRecovery: 5000,
            } }],
        });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(sheet.getCell('A1').value).toBe('Example employer');
        expect(sheet.getRow(5).values).toEqual([undefined, ...EXPECTED_HEADERS]);
        expect(sheet.getCell('B6').type).toBe(ExcelJS.ValueType.String);
        expect(sheet.getCell('C6').value).toBe('00001');
        expect(sheet.getCell('E6').value).toEqual(new Date('2025-04-01T00:00:00Z'));
        expect(sheet.getCell('E6').numFmt).toBe('dd/mm/yyyy');
        expect(sheet.getCell('I6').value).toBe(1200000.25);
        expect(sheet.getCell('I6').type).toBe(ExcelJS.ValueType.Number);
        expect(sheet.getCell('P6').value).toBe(4807.69); // Previous income-tax component
        expect(sheet.getCell('AG6').value).toBe(0); // A calculated zero must not become a dash.
        expect(sheet.getCell('AG6').type).toBe(ExcelJS.ValueType.Number);
        expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 5 });
        expect(workbook.getWorksheet('Report Notes')!.getRow(4).getCell(2).value).toBe(1);
    });
    it('blanks old-regime cells under the new regime and preserves the separation date', async () => {
        const row = { employeeId: '1', warnings: [], form12BApplicable: true, values: {
            excessRent: 180000, regime: 'New Regime', leavingDate: '2025-10-15', leftOrg: 'No', previousPF: 1800,
            previousPT: 1250, previousIT: 4807.69, hraExemption: 120000, pt: 2400, otherIncome: -10000,
        } };
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z',
            employer: { name: 'Example', address: 'Example' }, columns: REPORT_COLUMNS, notes: REPORT_NOTES, rows: [row] });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        for (const cell of ['K6', 'V6', 'Y6']) expect(sheet.getCell(cell).value).toBeNull();
        expect(sheet.getCell('R6').value).toBe(0);
        expect(sheet.getCell('Q6').value).toBe(1800);
        expect(sheet.getCell('P6').value).toBe(4807.69);
        expect(sheet.getCell('F6').value).toEqual(new Date('2025-10-15T00:00:00Z'));
    });

    it('exports numeric summary net tax, relief and zero while excluding Income Tax Paid', async () => {
        const rows = [50250, 0].map((netTax, index) => buildConsolidatedRow({employee: {_id: String(index)},
            financialYear: '2026-2027', serial: index + 1, salaries: [],
            declaration: {regime: 'old', annualGross: 1400000, ptDeduction: 1250, declarations: [],
                initialTaxBreakdown: {totalTaxAmount: netTax, cessAmount: netTax == 0 ? 0 : 2010, rebateAmount: 0, marginalReliefAmount: 0}}
        }));
        const buffer = await exportConsolidatedTaxWorkbook({financialYear: '2026-2027', generatedAt: '2026-10-07T00:00:00Z',
            employer: {name: 'Example', address: 'Example'}, columns: REPORT_COLUMNS, notes: REPORT_NOTES, rows});
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(sheet.columnCount).toBe(34);
        expect(sheet.getCell('AD6').value).toBe(50250);
        expect(sheet.getCell('AF6').value).toBe(2010);
        expect(sheet.getCell('AG6').value).toBe(52260);
        expect(sheet.getCell('AG6').value).toBe(Number(sheet.getCell('AD6').value) + Number(sheet.getCell('AF6').value));
        for (const address of ['AH6', 'AD7', 'AF7', 'AG7', 'AH7']) {
            expect(sheet.getCell(address).value).toBe(0);
            expect(sheet.getCell(address).type).toBe(ExcelJS.ValueType.Number);
        }
    });

});
