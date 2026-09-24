import * as fsPromises from 'fs/promises';
import path from 'path';
import { Types } from 'mongoose';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import { Document, IDocument } from '../models/document.model';
import { TaxDeclaration } from '../models/tax-declaration';
import { IUser, User } from '../models/user.model';
import { Payroll } from '../models/payrolls.model';
import { TaxSlab } from '../models/tax-slab.model';
import { deleteFileFromGCP, getSignedFileUrl, uploadFileToGCP } from '../utilis/gcpStorage';
import {
    assertForm16FinancialYear,
    calculateForm16,
    FORM16_TEMPLATE_VERSION,
    getForm16AssessmentYear,
} from './form16-calculation.service';
import { Form16PdfData, generateForm16PDF } from './form16-puppeteer.helper';
import form16EmployerConfig from '../config/form16-employer.json';

export interface Form16GenerateInput {
    employeeId: string;
    financialYear: string;
    generationRequestId?: string;
}

export interface Form16CandidatesQuery {
    financialYear: string;
    page?: number;
    limit?: number;
    departmentId?: string;
    activeStatus?: boolean | string;
    search?: string;
    reportStatus?: 'generated' | 'notGenerated';
}

export interface Form16BulkGenerateInput {
    financialYear: string;
    selectionMode?: 'explicit' | 'allMatching';
    employeeIds?: string[];
    excludedEmployeeIds?: string[];
    filters?: Pick<Form16CandidatesQuery, 'departmentId' | 'activeStatus' | 'search' | 'reportStatus'>;
}

const safeFilePart = (value: unknown, fallback: string): string => {
    const sanitized = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 80);
    return sanitized || fallback;
};

const form16FileName = (
    employee: { name?: string; employeeCode?: string },
    employeeId: string,
    financialYear: string,
    version: number,
): string => `Form16_${safeFilePart(employee.name, 'Employee')}_${safeFilePart(employee.employeeCode || employeeId, employeeId)}_FY${financialYear}_v${version}.pdf`;

const formatDate = (value: Date): string => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
}).format(value).replace(/ /g, '-');

const getEmployerConfig = () => ({
    name: String(form16EmployerConfig.name || process.env.FORM16_EMPLOYER_NAME || process.env.COMPANY_NAME || '').trim(),
    address: String(form16EmployerConfig.address || process.env.FORM16_EMPLOYER_ADDRESS || '').trim(),
    email: String(form16EmployerConfig.email || process.env.FORM16_EMPLOYER_EMAIL || process.env.GMAIL_AUTH_USER || '').trim(),
    pan: String(form16EmployerConfig.pan || process.env.FORM16_EMPLOYER_PAN || '').trim().toUpperCase(),
    tan: String(form16EmployerConfig.tan || process.env.FORM16_EMPLOYER_TAN || '').trim().toUpperCase(),
    citName: String(form16EmployerConfig.citName || process.env.FORM16_CIT_NAME || '').trim(),
    citAddress: String(form16EmployerConfig.citAddress || process.env.FORM16_CIT_ADDRESS || '').trim(),
});

export class Form16ReportService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    private assertAdmin(): Types.ObjectId {
        if (String(this.context.user?.role || '').toLowerCase() !== 'admin' || !this.context.user?._id) {
            throw new Error('Only administrators can generate Form 16 reports');
        }
        return new Types.ObjectId(this.context.user._id);
    }

    private validateEmployerConfig(): ReturnType<typeof getEmployerConfig> {
        const employer = getEmployerConfig();
        const missing = [
            ['name', employer.name],
            ['address', employer.address],
            ['pan', employer.pan],
            ['tan', employer.tan],
            ['citName', employer.citName],
            ['citAddress', employer.citAddress],
        ].filter(([, value]) => !value).map(([key]) => key);
        if (missing.length) {
            throw new Error(`Form 16 employer configuration is incomplete. Update src/config/form16-employer.json. Missing: ${missing.join(', ')}`);
        }
        return employer;
    }

    private getEmploymentPeriod(user: any, financialYear: string): { from: Date; to: Date } {
        const startYear = Number(financialYear.slice(0, 4));
        const financialYearStart = new Date(Date.UTC(startYear, 3, 1));
        const financialYearEnd = new Date(Date.UTC(startYear + 1, 2, 31));
        const joinedAt = user.joiningDate ? new Date(user.joiningDate) : financialYearStart;
        const separatedAt = user.separationDate ? new Date(user.separationDate) : financialYearEnd;
        return {
            from: joinedAt > financialYearStart ? joinedAt : financialYearStart,
            to: separatedAt < financialYearEnd ? separatedAt : financialYearEnd,
        };
    }

    private getFinancialYearPayrollFilter(employeeId: string, financialYear: string): any {
        const startYear = Number(financialYear.slice(0, 4));
        return {
            employeeId: new Types.ObjectId(employeeId),
            status: { $nin: ['Cancelled', 'Failed'] },
            $or: [
                { year: startYear, month: { $gte: 4 } },
                { year: startYear + 1, month: { $lte: 3 } },
            ],
        };
    }

    private buildPayrollTaxSource(payrolls: any[]): any {
        const annualGross = payrolls.reduce((total, payroll) => {
            const payrollGross = Number.isFinite(Number(payroll.attendanceAdjustGross))
                ? Number(payroll.attendanceAdjustGross)
                : Number(payroll.monthlyGross || 0);
            return total + payrollGross + Number(payroll.bonus || 0) + Number(payroll.overtimePay || 0);
        }, 0);
        return {
            regime: 'new',
            annualGross,
            standardDeduction: 0,
            ptDeduction: payrolls.reduce((total, payroll) => total + Number(payroll.professionalTax || 0), 0),
            declarations: [],
            taxPaid: payrolls.reduce((total, payroll) => total + Number(payroll.incomeTax || 0), 0),
            source: 'payroll',
        };
    }

    private async getSourceData(employeeId: string, financialYear: string): Promise<{ user: any; taxDeclaration: any }> {
        const [user, storedTaxDeclaration, panDocument, payrolls] = await Promise.all([
            User.findById(employeeId)
                .select('name email employeeCode address location joiningDate separationDate governmentIds country isConsultancy isIntern')
                .lean(),
            TaxDeclaration.findOne({ employeeId: new Types.ObjectId(employeeId), financialYear }).lean(),
            Document.findOne({
                employeeId: new Types.ObjectId(employeeId),
                category: 'Certification',
                'metadata.certificate.certificateType': 'IdentityProof',
                'metadata.certificate.idDetails.idType': 'PAN',
            }).sort({ uploadDate: -1 }).lean(),
            Payroll.find(this.getFinancialYearPayrollFilter(employeeId, financialYear))
                .select('attendanceAdjustGross monthlyGross bonus overtimePay professionalTax incomeTax month year status')
                .lean(),
        ]);
        if (!user) throw new Error('Employee not found');
        if (user.isConsultancy || user.isIntern) throw new Error('Form 16 generation is not available for consultancy or intern records');
        if (!storedTaxDeclaration && !payrolls.length) {
            throw new Error(`No tax declaration or payroll records found for FY ${financialYear}`);
        }
        const pan = String(
            user.governmentIds?.pan?.number || panDocument?.metadata?.certificate?.idDetails?.idNumber || '',
        ).trim().toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('A valid employee PAN is required to generate Form 16');
        (user as any).form16Pan = pan;
        const taxDeclaration = storedTaxDeclaration || this.buildPayrollTaxSource(payrolls);
        return { user, taxDeclaration };
    }

    private mapPdfData(user: any, taxDeclaration: any, taxSlab: any, financialYear: string): Form16PdfData {
        const employer = this.validateEmployerConfig();
        const calculation = calculateForm16({
            annualGross: Number(taxDeclaration.annualGross || 0),
            regime: taxDeclaration.regime === 'new' ? 'new' : 'old',
            standardDeduction: Number(taxSlab.standardDeduction || taxDeclaration.standardDeduction || 0),
            professionalTax: Number(taxDeclaration.ptDeduction || 0),
            declarations: taxDeclaration.declarations || [],
            financialYear,
            taxSlabs: taxSlab.slabs || [],
            cessRate: Number(taxSlab.cessRate || 0),
        });
        const period = this.getEmploymentPeriod(user, financialYear);
        const generatedAt = new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata',
        }).format(new Date()).replace(',', '');

        return {
            employeeId: user._id.toString(),
            employeeName: String(user.name || ''),
            employeeAddress: String(user.address || user.location || ''),
            employeePan: String(user.form16Pan || '').toUpperCase(),
            employeeCode: String(user.employeeCode || ''),
            employerName: employer.name,
            employerAddress: employer.address,
            employerEmail: employer.email,
            employerPan: employer.pan,
            employerTan: employer.tan,
            citName: employer.citName,
            citAddress: employer.citAddress,
            financialYear,
            assessmentYear: getForm16AssessmentYear(financialYear),
            periodFrom: formatDate(period.from),
            periodTo: formatDate(period.to),
            optedOutOfNewRegime: taxDeclaration.regime === 'old',
            generatedAt,
            calculation,
        };
    }

    async generate(input: Form16GenerateInput): Promise<IDocument> {
        const performedBy = this.assertAdmin();
        const employeeId = String(input.employeeId || '');
        if (!Types.ObjectId.isValid(employeeId)) throw new Error('A valid employee ID is required');
        assertForm16FinancialYear(input.financialYear);

        const { user, taxDeclaration } = await this.getSourceData(employeeId, input.financialYear);
        const taxSlab = await TaxSlab.findOne({
            financialYear: input.financialYear,
            regime: taxDeclaration.regime,
            isActive: true,
        }).lean();
        if (!taxSlab) {
            throw new Error(`Active tax slab not found for FY ${input.financialYear} and ${taxDeclaration.regime} regime`);
        }
        let existing = await Document.findOne({
            employeeId: new Types.ObjectId(employeeId),
            type: 'Form16',
            'metadata.form16.financialYear': input.financialYear,
        });
        if (input.generationRequestId && existing?.metadata?.form16?.generationRequestId === input.generationRequestId) {
            return existing;
        }

        const version = existing ? Number(existing.version || 1) + 1 : 1;
        const fileName = form16FileName(user, employeeId, input.financialYear, version);
        const outputDirectory = path.join(process.cwd(), 'uploads');
        const outputPath = path.join(outputDirectory, fileName);
        const pdfData = this.mapPdfData(user, taxDeclaration, taxSlab, input.financialYear);
        let uploadedUrl = '';

        await fsPromises.mkdir(outputDirectory, { recursive: true });
        try {
            await generateForm16PDF(pdfData, outputPath);
            const upload = await uploadFileToGCP({
                filePath: outputPath,
                fileName,
                employeeId,
                category: 'Tax',
                type: 'Form16',
                cacheControl: 'no-store, max-age=0',
            });
            if (!upload.success || !upload.fileUrl) throw new Error(upload.error || 'Unable to upload Form 16 PDF');
            uploadedUrl = upload.fileUrl;

            const generatedAt = new Date();
            const form16Metadata: any = {
                financialYear: input.financialYear,
                assessmentYear: pdfData.assessmentYear,
                pan: pdfData.employeePan,
                tdsAmount: pdfData.calculation.netTaxPayable,
                regime: taxDeclaration.regime,
                ...(taxDeclaration._id ? { taxDeclarationId: taxDeclaration._id } : {}),
                templateVersion: FORM16_TEMPLATE_VERSION,
                generationStatus: 'Completed',
                generationRequestId: input.generationRequestId,
                generatedAt,
                generatedBy: performedBy,
                calculationSnapshot: pdfData.calculation,
            };
            if (existing) {
                const previousVersions = existing.metadata?.form16?.previousVersions || [];
                previousVersions.push({
                    version: existing.version,
                    fileName: existing.fileName,
                    filePath: existing.filePath,
                    generatedAt: existing.metadata?.form16?.generatedAt || existing.uploadDate,
                });
                form16Metadata.previousVersions = previousVersions.slice(-20);
                Object.assign(existing, {
                    fileName,
                    filePath: uploadedUrl,
                    uploadDate: generatedAt,
                    uploadedBy: performedBy,
                    updatedBy: performedBy,
                    status: 'Generated',
                    version,
                    tags: ['Form16', input.financialYear],
                    metadata: { form16: form16Metadata },
                });
                existing.auditLog ||= [];
                existing.auditLog.push({
                    action: 'Re-Generate',
                    performedBy,
                    timestamp: generatedAt,
                    details: `Form 16 re-generated for ${user.name} for FY ${input.financialYear}`,
                });
                return await existing.save();
            }

            return await new Document({
                employeeId: new Types.ObjectId(employeeId),
                type: 'Form16',
                category: 'Tax',
                fileName,
                filePath: uploadedUrl,
                uploadDate: generatedAt,
                uploadedBy: performedBy,
                updatedBy: performedBy,
                accessLevel: 'Private',
                status: 'Generated',
                version: 1,
                tags: ['Form16', input.financialYear],
                metadata: { form16: form16Metadata },
                auditLog: [{
                    action: 'Generate',
                    performedBy,
                    timestamp: generatedAt,
                    details: `Form 16 generated for ${user.name} for FY ${input.financialYear}`,
                }],
            }).save();
        } catch (error: any) {
            if (uploadedUrl) await deleteFileFromGCP(uploadedUrl).catch(() => undefined);
            throw new Error(`Failed to generate Form 16 for ${user.name}: ${error.message}`);
        } finally {
            await fsPromises.unlink(outputPath).catch(() => undefined);
        }
    }

    private async resolveAllMatchingEmployeeIds(input: Form16BulkGenerateInput): Promise<string[]> {
        const filters = input.filters || {};
        const generatedEmployeeIds = await Document.find({
            type: 'Form16',
            'metadata.form16.financialYear': input.financialYear,
        }).distinct('employeeId');
        const userQuery: any = {
            isConsultancy: { $ne: true },
            isIntern: { $ne: true },
        };
        if (filters.reportStatus === 'generated') userQuery._id = { $in: generatedEmployeeIds };
        if (filters.reportStatus === 'notGenerated') userQuery._id = { $nin: generatedEmployeeIds };
        if (filters.departmentId) userQuery.departmentId = filters.departmentId;
        if (filters.activeStatus !== undefined && filters.activeStatus !== '') {
            userQuery.active = filters.activeStatus === true || String(filters.activeStatus) === 'true';
        }
        if (filters.search?.trim()) {
            const escaped = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const expression = new RegExp(escaped, 'i');
            userQuery.$or = [{ name: expression }, { email: expression }, { employeeCode: expression }];
        }
        const excluded = new Set((input.excludedEmployeeIds || []).map(String));
        const users = await User.find(userQuery).select('_id').lean();
        return users.map((user: any) => user._id.toString()).filter((id) => !excluded.has(id));
    }

    async bulkGenerate(input: Form16BulkGenerateInput): Promise<any> {
        this.assertAdmin();
        assertForm16FinancialYear(input.financialYear);
        const employeeIds = input.selectionMode === 'allMatching'
            ? await this.resolveAllMatchingEmployeeIds(input)
            : Array.from(new Set(input.employeeIds || []));
        if (!employeeIds.length) throw new Error('Select at least one employee');
        if (employeeIds.length > 500) throw new Error('A maximum of 500 employees can be generated in one request');
        if (employeeIds.some((id) => !Types.ObjectId.isValid(id))) throw new Error('One or more employee IDs are invalid');

        const results: any[] = [];
        for (const employeeId of employeeIds) {
            try {
                const document = await this.generate({ employeeId, financialYear: input.financialYear });
                results.push({ employeeId, status: 'Generated', documentId: document._id });
            } catch (error: any) {
                results.push({ employeeId, status: 'Failed', error: String(error?.message || error) });
            }
        }
        const succeeded = results.filter((item) => item.status === 'Generated').length;
        return { total: results.length, succeeded, failed: results.length - succeeded, results };
    }

    async regenerate(documentId: string): Promise<IDocument> {
        this.assertAdmin();
        if (!Types.ObjectId.isValid(documentId)) throw new Error('A valid Form 16 document ID is required');
        const document = await Document.findOne({ _id: documentId, type: 'Form16' }).lean();
        if (!document) throw new Error('Form 16 document not found');
        const financialYear = document.metadata?.form16?.financialYear;
        if (!financialYear) throw new Error('Form 16 financial year metadata is missing');
        return this.generate({
            employeeId: document.employeeId.toString(),
            financialYear,
        });
    }

    async listCandidates(query: Form16CandidatesQuery): Promise<any> {
        this.assertAdmin();
        assertForm16FinancialYear(query.financialYear);
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
        const generatedEmployeeIds = await Document.find({
            type: 'Form16',
            'metadata.form16.financialYear': query.financialYear,
        }).distinct('employeeId');
        const generated = new Set(generatedEmployeeIds.map((id: any) => id.toString()));

        const userQuery: any = {
            isConsultancy: { $ne: true },
            isIntern: { $ne: true },
        };
        if (query.reportStatus === 'generated') userQuery._id = { $in: generatedEmployeeIds };
        if (query.reportStatus === 'notGenerated') userQuery._id = { $nin: generatedEmployeeIds };
        if (query.departmentId) userQuery.departmentId = query.departmentId;
        if (query.activeStatus !== undefined && query.activeStatus !== '') {
            userQuery.active = query.activeStatus === true || String(query.activeStatus) === 'true';
        }
        if (query.search?.trim()) {
            const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const expression = new RegExp(escaped, 'i');
            userQuery.$or = [{ name: expression }, { email: expression }, { employeeCode: expression }];
        }

        const [total, users] = await Promise.all([
            User.countDocuments(userQuery),
            User.find(userQuery)
                .select('_id name email employeeCode departmentId active joiningDate governmentIds.pan.number')
                .sort({ name: 1, _id: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);
        return {
            items: users.map((user: any) => ({ ...user, form16Generated: generated.has(user._id.toString()) })),
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getAccessUrl(documentId: string, user: Partial<IUser>, download: boolean): Promise<{ url: string; fileName: string }> {
        if (!Types.ObjectId.isValid(documentId)) throw new Error('Invalid document ID');
        const document = await Document.findOne({ _id: documentId, type: 'Form16' }).lean();
        if (!document) throw new Error('Form 16 document not found');
        const isAdmin = String(user.role || '').toLowerCase() === 'admin';
        const isOwner = document.employeeId.toString() === user._id?.toString();
        if (!isAdmin && !isOwner) throw new Error('You are not authorized to access this Form 16');
        const url = await getSignedFileUrl(document.filePath, {
            downloadFileName: download ? document.fileName : undefined,
        });
        return { url, fileName: document.fileName };
    }
}
