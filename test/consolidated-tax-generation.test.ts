import { Types } from 'mongoose';
import { consolidatedTaxArtifactStore as store } from '../src/services/consolidated-tax-artifact.store';
import { loadConsolidatedTaxReport, exportConsolidatedTaxWorkbook } from '../src/services/consolidated-tax-report.service';
import { generateYearlyTaxReport, downloadYearlyTaxReport, approvalSummary } from '../src/services/consolidated-tax-generation.service';
jest.mock('../src/services/consolidated-tax-artifact.store', () => ({ consolidatedTaxArtifactStore: Object.fromEntries(['get', 'acquire', 'upload', 'commit', 'release', 'remove', 'download'].map(key => [key, jest.fn()])) }));
jest.mock('../src/services/consolidated-tax-report.service', () => ({ loadConsolidatedTaxReport: jest.fn(), exportConsolidatedTaxWorkbook: jest.fn() }));
const fy = '2025-2026', oldId = new Types.ObjectId(), newId = new Types.ObjectId();
const admin = { id: String(new Types.ObjectId()), name: 'Admin' };
const report: any = { financialYear: fy, generatedAt: '2026-01-01T00:00:00Z', rows: [{ employeeId: '1', values: { name: 'Employee', employeeCode: '001' }, warnings: ['Pending'], approvalWarnings: ['Pending'] }] };
beforeEach(() => {
    jest.mocked(store.acquire).mockResolvedValue({ _id: fy, revision: 1, fileId: oldId });
    jest.mocked(loadConsolidatedTaxReport).mockResolvedValue(report);
    jest.mocked(exportConsolidatedTaxWorkbook).mockResolvedValue(Buffer.from('xlsx'));
    jest.mocked(store.upload).mockResolvedValue(String(newId));
    jest.mocked(store.commit).mockResolvedValue({ _id: fy, revision: 2, fileId: newId, unapprovedEmployeeCount: 1 } as any);
    jest.mocked(store.release).mockResolvedValue(undefined);
    jest.mocked(store.remove).mockResolvedValue(undefined);
});
it('warns for unapproved employees but generates the whole FY and atomically replaces the saved file', async () => {
    expect(approvalSummary(report).unapprovedEmployeeCount).toBe(1);
    const result = await generateYearlyTaxReport(fy, admin);
    expect(result).toMatchObject({ exists: true, revision: 2, unapprovedEmployeeCount: 1 });
    expect(loadConsolidatedTaxReport).toHaveBeenCalledWith({ financialYear: fy });
    expect(store.commit).toHaveBeenCalledWith(fy, expect.any(String), expect.objectContaining({ unapprovedEmployeeCount: 1, employeeCount: 1 }));
    expect(store.remove).toHaveBeenCalledWith(String(oldId));
    expect(jest.mocked(store.commit).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(store.remove).mock.invocationCallOrder[0]);
    expect(store.release).toHaveBeenCalled();
    expect(result).not.toHaveProperty('fileId');
});
it('preserves the prior file when building the update fails', async () => {
    jest.mocked(exportConsolidatedTaxWorkbook).mockRejectedValueOnce(new Error('Build failed'));
    await expect(generateYearlyTaxReport(fy, admin)).rejects.toThrow('Build failed');
    expect(store.commit).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalled();
});
it('rejects simultaneous generation without overwriting an active lease', async () => {
    jest.mocked(store.acquire).mockResolvedValueOnce(null);
    await expect(generateYearlyTaxReport(fy, admin)).rejects.toMatchObject({ statusCode: 409 });
    expect(loadConsolidatedTaxReport).not.toHaveBeenCalled();
});
it('downloads saved bytes without recalculating', async () => {
    jest.mocked(store.get).mockResolvedValueOnce({ _id: fy, revision: 1, fileId: oldId, fileName: 'year.xlsx' } as any);
    jest.mocked(store.download).mockResolvedValueOnce(Buffer.from('saved'));
    expect(await downloadYearlyTaxReport(fy)).toEqual({ fileName: 'year.xlsx', buffer: Buffer.from('saved') });
    expect(loadConsolidatedTaxReport).not.toHaveBeenCalled();
});
it('requires generation before first download', async () => {
    jest.mocked(store.get).mockResolvedValueOnce(null);
    await expect(downloadYearlyTaxReport(fy)).rejects.toMatchObject({ statusCode: 404 });
});
