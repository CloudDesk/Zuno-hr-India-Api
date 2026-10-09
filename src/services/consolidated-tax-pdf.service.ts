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
import { ConsolidatedTaxPdf, IConsolidatedTaxPdf } from '../models/consolidated-tax-pdf.model';
import { financialYearRange, SalarySource } from './consolidated-tax-calculation';
import { buildPdfEmployee } from './consolidated-tax-pdf-calculation';
import { ConsolidatedPdfData, renderConsolidatedTaxPdf } from './consolidated-tax-pdf-renderer';
import { deleteFileFromGCP, getSignedFileUrl, uploadFileToGCP } from '../utilis/gcpStorage';

function group<T extends { employeeId: unknown }>(items: T[]): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const item of items) { const id = String(item.employeeId); const list = result.get(id) || []; list.push(item); result.set(id, list); }
    return result;
}
export async function loadConsolidatedPdfData(financialYear: string): Promise<ConsolidatedPdfData> {
    const { year } = financialYearRange(financialYear);
    const start = new Date(`${year}-04-01T00:00:00+05:30`), end = new Date(`${year + 1}-03-31T23:59:59.999+05:30`);
    const users = await User.find({ country: 'IN', isConsultancy: { $ne: true }, isIntern: { $ne: true }, $and: [
        { $or: [{ joiningDate: { $lte: end } }, { joiningDate: null }] },
        { $or: [{ separationDate: { $gte: start } }, { separationDate: null }] },
    ] }).select('_id name employeeCode governmentIds location gender residentialStatus dateOfBirth joiningDate separationDate').sort({ employeeCode: 1, _id: 1 }).lean();
    if (!users.length) throw new Error('No eligible employees were employed during this financial year.');
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
    return { financialYear, generatedAt: new Date().toISOString(), employer: { name: profile.legalName,
        address: [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ') }, employees };
}
function status(financialYear: string, record: IConsolidatedTaxPdf | null) {
    return { financialYear, exists: Boolean(record?.fileUrl), isGenerating: Boolean(record?.generationExpiresAt && record.generationExpiresAt > new Date()),
        revision: record?.revision || 0, fileName: record?.fileName, generatedAt: record?.generatedAt?.toISOString(), generatedByName: record?.generatedByName,
        employeeCount: record?.employeeCount || 0, reviewCount: record?.reviewCount || 0 };
}
export async function getConsolidatedPdfStatus(financialYear: string) {
    financialYearRange(financialYear);
    return status(financialYear, await ConsolidatedTaxPdf.findById(financialYear).lean());
}
export async function getConsolidatedPdfUrl(financialYear: string, download = false): Promise<string> {
    financialYearRange(financialYear);
    const record = await ConsolidatedTaxPdf.findById(financialYear).lean();
    if (!record?.fileUrl) throw new Error('Generate the PDF for this financial year first.');
    return getSignedFileUrl(record.fileUrl, download ? { downloadFileName: `Consolidated_Tax_Report_${financialYear}.pdf` } : {});
}
export async function generateConsolidatedPdf(financialYear: string, adminName: string) {
    financialYearRange(financialYear);
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
    const fileName = `Consolidated_Tax_Report_${financialYear}_${token}.pdf`, filePath = path.join(directory, fileName);
    let uploadedUrl: string | undefined;
    let published = false;
    try {
        await fs.mkdir(directory);
        const data = await loadConsolidatedPdfData(financialYear);
        await renderConsolidatedTaxPdf(data, filePath);
        const upload = await uploadFileToGCP({ filePath, fileName, employeeId: 'consolidated-tax-pdf', category: 'Tax', type: 'ConsolidatedTaxPdf', public: false, cacheControl: 'no-store, max-age=0' });
        if (!upload.success || !upload.fileUrl) throw new Error(upload.error || 'Unable to upload consolidated PDF.');
        uploadedUrl = upload.fileUrl;
        const record = await ConsolidatedTaxPdf.findOneAndUpdate({ _id: financialYear, generationToken: token }, {
            $set: { fileUrl: uploadedUrl, fileName, generatedAt: new Date(data.generatedAt), generatedByName: adminName,
                employeeCount: data.employees.length, reviewCount: data.employees.filter(e => e.warnings.length).length },
            $inc: { revision: 1 }, $unset: { generationToken: 1, generationExpiresAt: 1 },
        }, { new: true }).lean();
        if (!record) throw new Error('PDF generation was superseded. Please refresh to download the latest PDF.');
        published = true;
        if (previous.fileUrl && previous.fileUrl !== uploadedUrl) await deleteFileFromGCP(previous.fileUrl).catch(() => undefined);
        return status(financialYear, record);
    } catch (error) {
        if (uploadedUrl && !published) {
            // Resolve an uncertain DB commit before deleting a candidate PDF.
            try {
                const current = await ConsolidatedTaxPdf.findById(financialYear).lean();
                if (current?.fileUrl !== uploadedUrl) await deleteFileFromGCP(uploadedUrl);
            } catch { /* Keep the candidate when commit state cannot be confirmed. */ }
        }
        throw error;
    } finally {
        await ConsolidatedTaxPdf.updateOne({ _id: financialYear, generationToken: token }, { $unset: { generationToken: 1, generationExpiresAt: 1 } }).catch(() => undefined);
        // Remove only the files in this request's freshly-created temporary directory.
        await fs.unlink(filePath).catch(() => undefined);
        await fs.rmdir(directory).catch(() => undefined);
    }
}
