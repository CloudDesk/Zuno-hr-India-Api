import ExcelJS from 'exceljs';
import { exportConsolidatedTaxWorkbook } from '../src/services/consolidated-tax-report.service';
import { buildConsolidatedRow, REPORT_COLUMNS, REPORT_NOTES } from '../src/services/consolidated-tax-calculation';

describe('Consolidated tax Excel output', () => {
    it('exports all 60 columns with numeric placeholders while showing unavailable required values as dashes', async () => {
        const row = buildConsolidatedRow({ employee: { _id: '1' }, financialYear: '2025-2026', serial: 1, salaries: [],
            previous: { previousPF: 1800, professionalTax: 1250, previousSurcharge: 150 } });
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z',
            employer: { name: 'Example', address: 'Example' }, columns: REPORT_COLUMNS, notes: [...REPORT_NOTES], rows: [row] });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(REPORT_COLUMNS).toHaveLength(60);
        expect(sheet.getCell('R6').value).toBe(1800); // Declared previous PF
        expect(sheet.getCell('S6').value).toBe(1250); // Previous PT
        expect(sheet.getCell('AQ6').value).toBe(150); // Declared previous surcharge
        expect(sheet.getCell('AM6').value).toBe(0); // Direct TDS
        expect(sheet.getCell('AW6').value).toBe(0); // Section 89
        expect(sheet.getCell('BG6').value).toBe(0); // Extra balance field
        expect(sheet.getCell('I6').value).toBe('-'); // Missing required gross
        expect(sheet.getCell('AH6').value).toBe('-'); // Missing required annual tax
    });
    it('exports missing previous PF and surcharge as numeric zeroes', async () => {
        const row = buildConsolidatedRow({ employee: { _id: '1' }, financialYear: '2025-2026', serial: 1, salaries: [] });
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z',
            employer: { name: 'Example', address: 'Example' }, columns: REPORT_COLUMNS, notes: [...REPORT_NOTES], rows: [row] });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(sheet.getCell('R6').value).toBe(0);
        expect(sheet.getCell('AQ6').value).toBe(0);
    });
    it('preserves template ordering, typed amounts/dates, literal text and review notes', async () => {
        const buffer = await exportConsolidatedTaxWorkbook({ financialYear: '2025-2026', generatedAt: '2026-01-01T00:00:00Z', employer: { name: 'Example employer', address: 'Example address' },
            columns: REPORT_COLUMNS, notes: [...REPORT_NOTES], rows: [{ employeeId: '1', warnings: ['Missing previous-employer details.'], values: {
                serial: 1, name: '=HYPERLINK("https://example.com")', employeeCode: '00001', joiningDate: '2025-04-01', gross: 1200000.25,
                totalTax: 0, taxPaid: 40000, taxBalance: -1250.5, currentRecovery: 5000,
            } }],
        });
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        const sheet = workbook.getWorksheet('Sheet1')!;
        expect(sheet.getCell('A1').value).toBe('Example employer');
        expect(sheet.getRow(5).values).toEqual([undefined, ...REPORT_COLUMNS.map(column => column.label)]);
        expect(sheet.getCell('B6').type).toBe(ExcelJS.ValueType.String);
        expect(sheet.getCell('C6').value).toBe('00001');
        expect(sheet.getCell('E6').value).toEqual(new Date('2025-04-01T00:00:00Z'));
        expect(sheet.getCell('E6').numFmt).toBe('dd/mm/yyyy');
        expect(sheet.getCell('I6').value).toBe(1200000.25);
        expect(sheet.getCell('I6').type).toBe(ExcelJS.ValueType.Number);
        expect(sheet.getCell('AH6').value).toBe(0); // A calculated zero must not become a dash.
        expect(sheet.getCell('AH6').type).toBe(ExcelJS.ValueType.Number);
        for (const [key, expected] of [['taxPaid', 40000], ['taxBalance', -1250.5], ['currentRecovery', 5000]] as const) {
            const cell = sheet.getRow(6).getCell(REPORT_COLUMNS.findIndex(column => column.key === key) + 1);
            expect(cell.value).toBe(expected);
            expect(cell.type).toBe(ExcelJS.ValueType.Number);
        }
        expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 5 });
        expect(workbook.getWorksheet('Report Notes')!.getRow(4).getCell(2).value).toBe(1);
    });
});
