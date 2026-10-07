import ExcelJS from 'exceljs';
import { User } from '../models/user.model';
import { TaxDeclaration } from '../models/tax-declaration';
import { TaxSlab } from '../models/tax-slab.model';
import { SalaryAssignment } from '../models/salary-assignments.model';
import { Document } from '../models/document.model';
import { OrganizationProfile } from '../models/organization-profile.model';
import {
    buildConsolidatedRow, financialYearRange, REPORT_NOTES, ReportColumn, ReportRow,
    SalarySource, TaxDeclarationSource, TaxSlabSource, visibleReportColumns,
} from './consolidated-tax-calculation';

export interface ConsolidatedTaxQuery {
    financialYear: string; regime?: 'old' | 'new'; departmentId?: string;
    search?: string; activeStatus?: 'true' | 'false'; page?: number; limit?: number;
}
export interface ConsolidatedTaxReport {
    financialYear: string; generatedAt: string; employer: { name: string; address: string };
    columns: ReportColumn[]; rows: ReportRow[]; notes: string[];
}
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function groupByEmployee<T extends { employeeId: unknown }>(items: T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const item of items) {
        const key = String(item.employeeId);
        result.set(key, [...(result.get(key) || []), item]);
    }
    return result;
}

/** Matches the database FY-overlap query and provides a final read-only guard for report rows. */
export function employeeOverlapsFinancialYear(
    employee: { joiningDate?: Date | string | null; separationDate?: Date | string | null },
    financialYear: string,
): boolean {
    const { start, end } = financialYearRange(financialYear);
    const joining = employee.joiningDate ? new Date(employee.joiningDate) : null;
    const separation = employee.separationDate ? new Date(employee.separationDate) : null;
    if ((joining && Number.isNaN(joining.getTime())) || (separation && Number.isNaN(separation.getTime()))) return false;
    return (!joining || joining <= end) && (!separation || separation >= start);
}

/** Only find/select/lean queries are permitted here. Never call tax recalculation methods. */
export async function loadConsolidatedTaxReport(query: ConsolidatedTaxQuery): Promise<ConsolidatedTaxReport> {
    const generatedAt = new Date();
    const { start, end } = financialYearRange(query.financialYear);
    const employeeFilter: Record<string, unknown> = {
        country: 'IN', isConsultancy: { $ne: true }, isIntern: { $ne: true },
        $and: [
            { $or: [{ joiningDate: { $lte: end } }, { joiningDate: null }] },
            { $or: [{ separationDate: { $gte: start } }, { separationDate: null }] },
        ],
    };
    if (query.departmentId) employeeFilter.departmentId = query.departmentId;
    if (query.activeStatus) employeeFilter.active = query.activeStatus === 'true';
    if (query.search?.trim()) {
        const regex = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
        employeeFilter.$or = [{ name: regex }, { employeeCode: regex }];
    }
    // Resolve regime from the selected FY, never the user's present-day regime.
    if (query.regime) {
        const matching = await TaxDeclaration.find({ financialYear: query.financialYear, regime: query.regime }).select('employeeId').lean();
        employeeFilter._id = { $in: matching.map(item => item.employeeId) };
    }
    const employees = (await User.find(employeeFilter)
        .select('_id name employeeCode joiningDate separationDate active governmentIds')
        .sort({ employeeCode: 1, _id: 1 }).lean())
        .filter(employee => employeeOverlapsFinancialYear(employee, query.financialYear));
    const employeeIds = employees.map(employee => employee._id);
    const [declarations, salaries, slabs, documents, profiles] = await Promise.all([
        TaxDeclaration.find({ employeeId: { $in: employeeIds }, financialYear: query.financialYear })
            .select('employeeId regime annualGross ptDeduction declarations initialTaxBreakdown isMigrationAdjusted isForm12BApplicable poiSubmissionStatus monthlyDeductions').lean(),
        SalaryAssignment.find({ employeeId: { $in: employeeIds }, effectiveFrom: { $lte: end }, effectiveTo: { $gte: start } })
            .select('employeeId effectiveFrom effectiveTo monthlyGross salaryStructureId')
            .populate('salaryStructureId', 'fixedEarnings statutoryDeductions.professionalTax').lean(),
        TaxSlab.find({ financialYear: query.financialYear, isActive: true }).lean(),
        Document.find({ employeeId: { $in: employeeIds }, $or: [
            { type: 'Form12B', 'metadata.form12B.financialYear': query.financialYear },
            { category: 'Certification', 'metadata.certificate.certificateType': 'IdentityProof', 'metadata.certificate.idDetails.idType': 'PAN' },
        ] }).select('employeeId type metadata.form12B metadata.certificate uploadDate').sort({ uploadDate: -1, _id: -1 }).lean(),
        OrganizationProfile.find({ status: 'Active' }).select('legalName addresses').limit(2).lean(),
    ]);
    const declarationMap = groupByEmployee(declarations);
    const salaryMap = groupByEmployee(salaries);
    const documentMap = groupByEmployee(documents);
    const rows = employees.map((employee, index) => {
        const id = String(employee._id);
        const sources = declarationMap.get(id) || [];
        const declaration = sources.length === 1 ? sources[0] : undefined;
        const matchingSlabs = slabs.filter(slab => slab.regime === declaration?.regime);
        const employeeDocuments = documentMap.get(id) || [];
        const forms = employeeDocuments.filter(document => document.type === 'Form12B');
        const pan = employee.governmentIds?.pan?.number || employeeDocuments.find(document => document.type !== 'Form12B')?.metadata?.certificate?.idDetails?.idNumber;
        const row = buildConsolidatedRow({
            employee: { ...employee, governmentIds: { pan: { number: pan } } },
            declaration: declaration as TaxDeclarationSource | undefined,
            slab: matchingSlabs.length === 1 ? matchingSlabs[0] as TaxSlabSource : undefined,
            salaries: (salaryMap.get(id) || []) as unknown as SalarySource[],
            previous: forms.length === 1 ? forms[0]?.metadata?.form12B : undefined,
            financialYear: query.financialYear, serial: index + 1, asOf: generatedAt,
        });
        if (sources.length > 1) row.warnings.push('Multiple FY tax declarations found; calculation requires source reconciliation.');
        if (forms.length > 1) {
            row.warnings.push('Multiple Form 12B records found; previous-employment figures require reconciliation.');
            row.approvalWarnings?.push('Multiple Form 12B records found; approval cannot be confirmed.');
            for (const key of ['previousIT', 'previousIncome', 'previousPF', 'previousPT', 'previousTax', 'previousSurcharge', 'previousCess']) row.values[key] = null;
        }
        if (declaration?.isForm12BApplicable && !forms.length) {
            row.warnings.push('Form 12B is applicable but no record exists for this FY; previous-employment fields require source information.');

        }
        return row;
    });
    const notes = [...REPORT_NOTES];
    const profile = profiles.length === 1 ? profiles[0] : undefined;
    if (!profile) throw new Error('Configure exactly one active Organization Profile before generating the report.');
    const address = profile.addresses.find(item => item.isPrimary && item.type === 'payroll') || profile.addresses.find(item => item.isPrimary && item.type === 'registered');
    if (!address || !profile.legalName) throw new Error('Organization Profile needs a legal name and primary payroll or registered address.');
    notes.push('Scope: Indian employees, including inactive employees employed during the selected FY. Consultancy and intern records are excluded, consistent with existing Form 16 reports.');
    return {
        financialYear: query.financialYear, generatedAt: generatedAt.toISOString(),
        employer: { name: profile.legalName, address: [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ') },
        columns: visibleReportColumns(rows), rows, notes,
    };
}

export async function exportConsolidatedTaxWorkbook(report: ConsolidatedTaxReport): Promise<Buffer> {
    // Enforce the specification even if a caller supplies additional legacy columns.
    const columns = visibleReportColumns(report.rows);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'HRMS';
    workbook.created = new Date(report.generatedAt);
    const sheet = workbook.addWorksheet('Sheet1', { views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }] });
    sheet.columns = columns.map(column => ({ key: column.key, width: column.key === 'name' ? 28 : column.type === 'date' ? 15 : column.type === 'money' ? 21 : 18 }));
    for (const [index, title] of [report.employer.name, report.employer.address, `Income Tax Statement (Consolidated) For The Financial Year ${report.financialYear}`].entries()) {
        sheet.mergeCells(index + 1, 1, index + 1, columns.length);
        const cell = sheet.getCell(index + 1, 1);
        cell.value = title;
        cell.font = { name: 'Arial', size: index === 0 ? 16 : index === 1 ? 10 : 13, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        sheet.getRow(index + 1).height = index === 1 ? 30 : 26;
    }
    const header = sheet.getRow(5);
    header.height = 65;
    columns.forEach((column, index) => {
        const cell = header.getCell(index + 1);
        cell.value = column.label;
        cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    report.rows.forEach((row, index) => {
        const target = sheet.getRow(index + 6);
        target.height = 22;
        columns.forEach((column, col) => {
            const cell = target.getCell(col + 1);
            const value = column.key === 'excessRent' && row.values.regime !== 'Old Regime' ? 0 : row.values[column.key];
            // Unavailable values are rendered as a visible dash; confirmed zero values remain numeric zero.
            // ExcelJS string values are literal strings, not executable formulas.
            const oldOnly = [ 'hraExemption', 'exemptions', 'previousPT', 'pt', 'otherIncome'];
            const previousOnly = ['previousIT', 'previousIncome', 'previousPF', 'previousPT', 'previousTax', 'previousSurcharge', 'previousCess'];
            const inapplicable = (oldOnly.includes(column.key) && row.values.regime !== 'Old Regime') ||
                (previousOnly.includes(column.key) && row.form12BApplicable === false);
            const previousZeroDefault = ['previousIT', 'previousPF', 'previousPT', 'previousIncome', 'rebate', 'surcharge', 'lta'].includes(column.key);
            cell.value = previousZeroDefault
                ? (inapplicable || value == null ? 0 : value)
                : inapplicable ? null
                : value == null ? '-' : column.type === 'date' && typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
            cell.numFmt = column.type === 'date' ? 'dd/mm/yyyy' : column.type === 'money' ? '#,##0.00' : '@';
            cell.font = { name: 'Arial', size: 10 };
            cell.alignment = { vertical: 'middle', horizontal: column.type === 'money' ? 'right' : 'left' };
            if (index % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } };
        });
    });
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, report.rows.length + 5), column: columns.length } };
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' };
    const notes = workbook.addWorksheet('Report Notes');
    notes.columns = [{ width: 24 }, { width: 110 }];
    notes.addRow(['Financial year', report.financialYear]);
    notes.addRow(['Generated at (UTC)', report.generatedAt]);
    notes.addRow(['Employees', report.rows.length]);
    notes.addRow(['Rows needing review', report.rows.filter(row => row.warnings.length).length]);
    report.notes.forEach(note => notes.addRow(['Calculation / scope', note]));
    notes.addRow(['Employee', 'Review warnings']);
    report.rows.filter(row => row.warnings.length).forEach(row => notes.addRow([`${row.values.employeeCode} - ${row.values.name}`, row.warnings.join('\n')]));
    notes.eachRow(row => {
        row.font = { name: 'Arial', size: 10 };
        row.alignment = { vertical: 'top', wrapText: true };
        row.height = Math.max(30, Math.ceil(String(row.getCell(2).value || '').length / 95) * 16);
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
