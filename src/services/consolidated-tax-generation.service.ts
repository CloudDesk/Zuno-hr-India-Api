import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { IConsolidatedTaxArtifact } from '../models/consolidated-tax-artifact.model';
import { consolidatedTaxArtifactStore as store } from './consolidated-tax-artifact.store';
import { financialYearRange } from './consolidated-tax-calculation';
import { ConsolidatedTaxReport, exportConsolidatedTaxWorkbook, loadConsolidatedTaxReport } from './consolidated-tax-report.service';

export interface YearlyReportStatus {
    financialYear: string; exists: boolean; isGenerating: boolean; revision: number;
    fileName?: string; generatedAt?: string; generatedByName?: string;
    employeeCount: number; reviewCount: number; unapprovedEmployeeCount: number;
}
export class ConsolidatedReportError extends Error {
    constructor(message: string, public readonly statusCode: number) { super(message); }
}
export function reportStatus(financialYear: string, record: IConsolidatedTaxArtifact | null): YearlyReportStatus {
    return { financialYear, exists: Boolean(record?.fileId), isGenerating: Boolean(record?.generationExpiresAt && record.generationExpiresAt > new Date()),
        revision: record?.revision || 0, fileName: record?.fileName, generatedAt: record?.generatedAt?.toISOString(), generatedByName: record?.generatedByName,
        employeeCount: record?.employeeCount || 0, reviewCount: record?.reviewCount || 0, unapprovedEmployeeCount: record?.unapprovedEmployeeCount || 0 };
}
export function approvalSummary(report: ConsolidatedTaxReport) {
    const employees = report.rows.filter(row => row.approvalWarnings?.length).map(row => ({
        employeeId: row.employeeId, name: String(row.values.name || ''), employeeCode: String(row.values.employeeCode || ''), warnings: row.approvalWarnings!,
    }));
    return { financialYear: report.financialYear, employeeCount: report.rows.length, unapprovedEmployeeCount: employees.length, employees };
}
export async function getYearlyReportStatus(financialYear: string): Promise<YearlyReportStatus> {
    financialYearRange(financialYear);
    return reportStatus(financialYear, await store.get(financialYear));
}

/** Always reload the entire FY. Approval warnings never reject or exclude an employee. */
export async function generateYearlyTaxReport(financialYear: string, admin: { id: string; name: string }): Promise<YearlyReportStatus> {
    financialYearRange(financialYear);
    if (!Types.ObjectId.isValid(admin.id)) throw new ConsolidatedReportError('Authenticated administrator ID is invalid.', 403);
    const token = randomUUID();
    const lease = await store.acquire(financialYear, token, new Date());
    if (!lease) throw new ConsolidatedReportError('Another administrator is generating this financial year. Please refresh shortly.', 409);
    let uploadedId: string | undefined;
    let published = false;
    try {
        const report = await loadConsolidatedTaxReport({ financialYear });
        const approval = approvalSummary(report);
        const workbook = await exportConsolidatedTaxWorkbook(report);
        const fileName = `Consolidated_Tax_Report_${financialYear}.xlsx`;
        uploadedId = await store.upload(financialYear, fileName, workbook);
        const record = await store.commit(financialYear, token, {
            fileId: new Types.ObjectId(uploadedId), fileName, generatedAt: new Date(report.generatedAt),
            generatedBy: new Types.ObjectId(admin.id), generatedByName: admin.name,
            employeeCount: report.rows.length, reviewCount: report.rows.filter(row => row.warnings.length).length,
            unapprovedEmployeeCount: approval.unapprovedEmployeeCount,
        });
        if (!record) throw new ConsolidatedReportError('Generation was superseded. Refresh to download the current yearly report.', 409);
        published = true;
        // Only replace the pointer after the complete workbook is durable. A failed update preserves the old file.
        if (lease.fileId && String(lease.fileId) !== uploadedId) {
            await store.remove(String(lease.fileId)).catch(() => console.warn('Old consolidated report file cleanup deferred.', { financialYear }));
        }
        return reportStatus(financialYear, record);
    } catch (error) {
        // A network failure can leave a successful DB commit without an acknowledgement.
        // Never delete the candidate if it is already the current report or the lookup fails.
        if (uploadedId && !published) {
            try {
                const current = await store.get(financialYear);
                if (String(current?.fileId || '') !== uploadedId) await store.remove(uploadedId);
            } catch { /* Retain the private candidate rather than risk deleting a committed report. */ }
        }
        throw error;
    } finally {
        await store.release(financialYear, token).catch(() => console.warn('Consolidated report lease will expire automatically.', { financialYear }));
    }
}

export async function downloadYearlyTaxReport(financialYear: string): Promise<{ fileName: string; buffer: Buffer }> {
    financialYearRange(financialYear);
    let record = await store.get(financialYear);
    if (!record?.fileId) throw new ConsolidatedReportError('Generate the Excel report for this financial year first.', 404);
    try {
        return { fileName: record.fileName!, buffer: await store.download(String(record.fileId)) };
    } catch (error) {
        // An update may retire the old file between the metadata read and opening the download.
        const latest = await store.get(financialYear);
        if (!latest?.fileId || String(latest.fileId) === String(record.fileId)) throw error;
        record = latest;
        return { fileName: record.fileName!, buffer: await store.download(String(record.fileId)) };
    }
}
