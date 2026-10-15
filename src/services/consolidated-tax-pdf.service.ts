import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { User } from '../models/user.model';
import { TaxDeclaration } from '../models/tax-declaration';
import { SalaryAssignment } from '../models/salary-assignments.model';
import { Payroll } from '../models/payrolls.model';
import { Document } from '../models/document.model';
import { OrganizationProfile } from '../models/organization-profile.model';
import { ConsolidatedTaxPdf, IConsolidatedTaxPdf, ConsolidatedTaxPdfPart } from '../models/consolidated-tax-pdf.model';
import { financialYearRange, SalarySource } from './consolidated-tax-calculation';
import { buildPdfEmployee } from './consolidated-tax-pdf-calculation';
import { ConsolidatedPdfData, renderConsolidatedTaxPdf } from './consolidated-tax-pdf-renderer';
import { deleteFileFromGCP, getSignedFileUrl, uploadFileToGCP } from '../utilis/gcpStorage';

function group<T extends { employeeId: unknown }>(items: T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const item of items) { const id = String(item.employeeId); const list = result.get(id) || []; list.push(item); result.set(id, list); }
    return result;
}
function eligibleEmployees(financialYear: string) {
    const { year } = financialYearRange(financialYear);
    const start = new Date(`${year}-04-01T00:00:00+05:30`), end = new Date(`${year + 1}-03-31T23:59:59.999+05:30`);
    return { country: 'IN', isConsultancy: { $ne: true }, isIntern: { $ne: true }, $and: [
        { $or: [{ joiningDate: { $lte: end } }, { joiningDate: null }] },
        { $or: [{ separationDate: { $gte: start } }, { separationDate: null }] },
    ] };
}
export async function loadConsolidatedPdfData(financialYear: string, part?: number): Promise<ConsolidatedPdfData & { employeeIds: string[]; totalEmployeeCount: number }> {
    const { year } = financialYearRange(financialYear);
    if (part !== undefined && (!Number.isInteger(part) || part < 1)) throw new Error('Invalid PDF part.');
    const start = new Date(`${year}-04-01T00:00:00+05:30`), end = new Date(`${year + 1}-03-31T23:59:59.999+05:30`);
    const allUsers = await User.find(eligibleEmployees(financialYear)).select('_id name employeeCode governmentIds location gender residentialStatus dateOfBirth joiningDate separationDate').sort({ employeeCode: 1, _id: 1 }).lean();
    if (!allUsers.length) throw new Error('No eligible employees were employed during this financial year.');
    const employeeIds = allUsers.map(user => String(user._id));
    const users = part === undefined ? allUsers : allUsers.slice((part - 1) * CONSOLIDATED_PDF_BATCH_SIZE, part * CONSOLIDATED_PDF_BATCH_SIZE);
    if (!users.length) throw new Error('This PDF part is unavailable. Refresh the employee list.');
    const ids = users.map(user => user._id);
    const [declarations, salaries, payrolls, documents, profiles] = await Promise.all([
        TaxDeclaration.find({ employeeId: { $in: ids }, financialYear }).select('employeeId regime declarations ptDeduction initialTaxBreakdown isMigrationAdjusted migrationAdjustment').lean(),
        SalaryAssignment.find({ employeeId: { $in: ids }, effectiveFrom: { $lte: end }, effectiveTo: { $gte: start } })
            .select('employeeId effectiveFrom effectiveTo monthlyGross salaryStructureId').populate('salaryStructureId', 'statutoryDeductions.professionalTax').lean(),
        Payroll.find({ employeeId: { $in: ids }, status: { $nin: ['Cancelled', 'Failed'] }, $or: [
            { year, month: { $gte: 4, $lte: 12 } },
            { year: year + 1, month: { $gte: 1, $lte: 3 } },
        ] }).select('employeeId year month status basic hra da otherAllowance travelAllowance airTicketAllowance medicalAllowance reimbursementAllowance epfEmployee professionalTax incomeTax processedAt isFinalSettlement type').sort({ processedAt: -1, _id: -1 }).lean(),
        Document.find({ employeeId: { $in: ids }, $or: [
            { type: 'Form12B', 'metadata.form12B.financialYear': financialYear },
            { category: 'Certification', 'metadata.certificate.certificateType': 'IdentityProof', 'metadata.certificate.idDetails.idType': 'PAN' },
        ] }).select('employeeId type metadata.form12B metadata.certificate').sort({ uploadDate: -1, _id: -1 }).lean(),
        OrganizationProfile.find({ status: 'Active' }).select('legalName addresses').limit(2).lean(),
    ]);
    if (profiles.length !== 1) throw new Error('Configure exactly one active Organization Profile before generating the PDF.');
    const profile = profiles[0];
    const addresses = profile.addresses || [];
    const address = addresses.find(a => a.isPrimary && a.type === 'payroll') || addresses.find(a => a.isPrimary && a.type === 'registered');
    if (!profile.legalName || !address) throw new Error('Organization Profile needs its legal name and primary payroll or registered address.');
    const declarationMap = group(declarations), salaryMap = group(salaries), payrollMap = group(payrolls), documentMap = group(documents);
    const employees = users.map(user => {
        const id = String(user._id), matches = declarationMap.get(id) || [], docs = documentMap.get(id) || [];
        const forms = docs.filter(d => d.type === 'Form12B').map(d => d.metadata?.form12B);
        const pan = String(user.governmentIds?.pan?.number || docs.find(d => d.type !== 'Form12B')?.metadata?.certificate?.idDetails?.idNumber || '');
        const employee = buildPdfEmployee(user, matches.length === 1 ? matches[0] : undefined, (salaryMap.get(id) || []) as unknown as SalarySource[], payrollMap.get(id) || [], forms, pan, financialYear);
        if (matches.length > 1) employee.warnings.push('Multiple FY declarations found; declaration-dependent amounts displayed as zero.');
        return employee;
    });
    return { employeeIds, totalEmployeeCount: allUsers.length, financialYear, generatedAt: new Date().toISOString(), employer: { name: profile.legalName,
        address: [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ') }, employees };
}
export const CONSOLIDATED_PDF_BATCH_SIZE = 100;
function savedParts(record: IConsolidatedTaxPdf | null): ConsolidatedTaxPdfPart[] {
    if (record?.parts?.length) return record.parts;
    return record?.fileUrl ? [{ part: 1, fileUrl: record.fileUrl, fileName: record.fileName || '', employeeCount: record.employeeCount || 0, firstEmployee: 1, lastEmployee: record.employeeCount || 0 }] : [];
}
function status(financialYear: string, record: IConsolidatedTaxPdf | null, employeeCount = record?.employeeCount || 0) {
    const parts = savedParts(record);
    const availableParts = Array.from({ length: Math.ceil(employeeCount / CONSOLIDATED_PDF_BATCH_SIZE) }, (_, index) => {
        const firstEmployee = index * CONSOLIDATED_PDF_BATCH_SIZE + 1;
        const lastEmployee = Math.min(employeeCount, (index + 1) * CONSOLIDATED_PDF_BATCH_SIZE);
        return { part: index + 1, firstEmployee, lastEmployee, employeeCount: lastEmployee - firstEmployee + 1,
            exists: parts.some(saved => saved.part === index + 1 && saved.firstEmployee === firstEmployee && saved.lastEmployee === lastEmployee) };
    });
    return { financialYear, availableParts, exists: parts.length > 0, isGenerating: Boolean(record?.generationExpiresAt && record.generationExpiresAt > new Date()),
        revision: record?.revision || 0, fileName: record?.fileName, generatedAt: record?.generatedAt?.toISOString(), generatedByName: record?.generatedByName,
        employeeCount, reviewCount: record?.reviewCount || 0, partCount: parts.length,
        parts: parts.map(({ fileUrl, ...part }) => ({ ...part, downloadFileName: `Consolidated_Tax_Report_${financialYear}${record?.parts?.length ? `_Part_${part.part}` : ''}.pdf` })) };
}
export async function getConsolidatedPdfStatus(financialYear: string) {
    financialYearRange(financialYear);
    const [record, users] = await Promise.all([
        ConsolidatedTaxPdf.findById(financialYear).lean(),
        User.find(eligibleEmployees(financialYear)).select('_id').sort({ employeeCode: 1, _id: 1 }).lean(),
    ]);
    return status(financialYear, record, users.length);
}
export async function getConsolidatedPdfUrl(financialYear: string, download = false, part = 1): Promise<string> {
    financialYearRange(financialYear);
    if (!Number.isInteger(part) || part < 1) throw new Error('Invalid PDF part.');
    const record = await ConsolidatedTaxPdf.findById(financialYear).lean();
    const parts = savedParts(record);
    if (!parts.length) throw new Error('Generate the PDF for this financial year first.');
    const selected = parts.find(item => item.part === part);
    if (!selected) throw new Error('This PDF part is unavailable. Refresh the saved reports.');
    const fileName = `Consolidated_Tax_Report_${financialYear}${record?.parts?.length ? `_Part_${part}` : ''}.pdf`;
    return getSignedFileUrl(selected.fileUrl, download ? { downloadFileName: fileName } : {});
}
export async function generateConsolidatedPdf(financialYear: string, adminName: string, selectedPart?: number) {
    financialYearRange(financialYear);
    if (selectedPart !== undefined && (!Number.isInteger(selectedPart) || selectedPart < 1)) throw new Error('Invalid PDF part.');
    const token = randomUUID(), now = new Date();
    let previous: IConsolidatedTaxPdf | null;
    try {
        previous = await ConsolidatedTaxPdf.findOneAndUpdate({ _id: financialYear,
            $or: [{ generationExpiresAt: { $exists: false } }, { generationExpiresAt: { $lte: now } }],
        }, { $set: { generationToken: token, generationExpiresAt: new Date(now.getTime() + 16 * 60 * 1000) } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new Error('Another administrator is generating this PDF. Please refresh shortly.');
        throw error;
    }
    if (!previous) throw new Error('Another administrator is generating this PDF. Please refresh shortly.');
    const directory = path.join(os.tmpdir(), `consolidated-tax-pdf-${token}`);
    const filePaths: string[] = [];
    const uploadedParts: ConsolidatedTaxPdfPart[] = [];
    let published = false;
    // One upload may run alongside the next render; never render two parts together.
    let pendingUpload: Promise<Error | undefined> | undefined;
    const startedAt = Date.now();
    const timing = (step: string, started: number, part?: number) => console.log(JSON.stringify({
        scope: 'consolidated_tax_pdf', step, financialYear, ...(part ? { part } : {}), durationMs: Date.now() - started,
    }));
    const finishUpload = async () => {
        const error = await pendingUpload;
        pendingUpload = undefined;
        if (error) throw error;
    };
    try {
        await fs.mkdir(directory);
        const dataStartedAt = Date.now();
        const data = await loadConsolidatedPdfData(financialYear, selectedPart);
        if (selectedPart !== undefined && ((previous.employeeIds && JSON.stringify(previous.employeeIds) !== JSON.stringify(data.employeeIds))
            || (previous.fileUrl && previous.employeeCount !== undefined && previous.employeeCount !== data.totalEmployeeCount))) {
            throw new Error('The eligible employee list changed. Select All parts to refresh the PDF groups.');
        }
        timing('load_report_data', dataStartedAt);
        for (let offset = 0; offset < data.employees.length; offset += CONSOLIDATED_PDF_BATCH_SIZE) {
            // Refresh ownership between bounded renders so large employee sets retain their lease.
            const lease = await ConsolidatedTaxPdf.updateOne({ _id: financialYear, generationToken: token },
                { $set: { generationExpiresAt: new Date(Date.now() + 16 * 60 * 1000) } });
            if (lease.matchedCount === 0) throw new Error('PDF generation was superseded. Please refresh.');
            const part = selectedPart ?? Math.floor(offset / CONSOLIDATED_PDF_BATCH_SIZE) + 1;
            const firstEmployee = (part - 1) * CONSOLIDATED_PDF_BATCH_SIZE + 1;
            const employees = data.employees.slice(offset, offset + CONSOLIDATED_PDF_BATCH_SIZE);
            const fileName = `Consolidated_Tax_Report_${financialYear}_Part_${part}_${token}.pdf`;
            const filePath = path.join(directory, fileName);
            filePaths.push(filePath);
            const renderStartedAt = Date.now();
            await renderConsolidatedTaxPdf({ ...data, employees }, filePath);
            timing('render_part', renderStartedAt, part);
            await finishUpload();
            const uploadStartedAt = Date.now();
            pendingUpload = (async () => {
                try {
                    const upload = await uploadFileToGCP({ filePath, fileName, employeeId: 'consolidated-tax-pdf', category: 'Tax', type: 'ConsolidatedTaxPdf', public: false, cacheControl: 'no-store, max-age=0' });
                    if (!upload.success || !upload.fileUrl) throw new Error(upload.error || 'Unable to upload consolidated PDF.');
                    uploadedParts.push({ part, fileUrl: upload.fileUrl, fileName, employeeCount: employees.length, firstEmployee, lastEmployee: firstEmployee + employees.length - 1, reviewCount: employees.filter(employee => employee.warnings.length).length });
                    return undefined;
                } catch (error) {
                    return error instanceof Error ? error : new Error(String(error));
                } finally { timing('upload_part', uploadStartedAt, part); }
            })();
        }
        await finishUpload();
        const parts = selectedPart === undefined ? uploadedParts : [
            ...savedParts(previous).filter(part => part.part !== selectedPart && part.employeeCount <= CONSOLIDATED_PDF_BATCH_SIZE),
            ...uploadedParts,
        ].sort((a, b) => a.part - b.part);
        const record = await ConsolidatedTaxPdf.findOneAndUpdate({ _id: financialYear, generationToken: token }, {
            $set: { parts, employeeIds: data.employeeIds, fileUrl: parts[0].fileUrl, fileName: parts[0].fileName, generatedAt: new Date(data.generatedAt), generatedByName: adminName,
                employeeCount: data.totalEmployeeCount, ...(parts.every(part => part.reviewCount !== undefined) ? { reviewCount: parts.reduce((total, part) => total + (part.reviewCount || 0), 0) } : {}) },
            $inc: { revision: 1 }, $unset: { generationToken: 1, generationExpiresAt: 1, ...(!parts.every(part => part.reviewCount !== undefined) ? { reviewCount: 1 } : {}) },
        }, { new: true }).lean();
        if (!record) throw new Error('PDF generation was superseded. Please refresh to download the latest PDF.');
        published = true;
        const newUrls = new Set(parts.map(part => part.fileUrl));
        for (const url of new Set(savedParts(previous).map(part => part.fileUrl))) {
            if (!newUrls.has(url)) await deleteFileFromGCP(url).catch(() => undefined);
        }
        timing('generation_complete', startedAt);
        return status(financialYear, record, data.totalEmployeeCount);
    } catch (error) {
        // A render can fail while the prior upload is still running. Settle it before cleanup.
        await pendingUpload;
        pendingUpload = undefined;
        if (uploadedParts.length && !published) {
            // Resolve an uncertain DB commit before deleting any candidate part.
            try {
                const current = await ConsolidatedTaxPdf.findById(financialYear).lean();
                const currentUrls = new Set(savedParts(current).map(part => part.fileUrl));
                for (const part of uploadedParts) {
                    if (!currentUrls.has(part.fileUrl)) await deleteFileFromGCP(part.fileUrl).catch(() => undefined);
                }
            } catch { /* Keep candidates when commit state cannot be confirmed. */ }
        }
        throw error;
    } finally {
        await ConsolidatedTaxPdf.updateOne({ _id: financialYear, generationToken: token }, { $unset: { generationToken: 1, generationExpiresAt: 1 } }).catch(() => undefined);
        // Remove only the files in this request's freshly-created temporary directory.
        for (const filePath of filePaths) await fs.unlink(filePath).catch(() => undefined);
        await fs.rmdir(directory).catch(() => undefined);
    }
}
