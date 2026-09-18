import { createHash } from 'crypto';
import * as fsPromises from 'fs/promises';
import path from 'path';
import { Types } from 'mongoose';
import { BaseService } from './base.service';
import { Document, IDocument } from '../models/document.model';
import { TaxDeclaration } from '../models/tax-declaration';
import { User } from '../models';
import { deleteFileFromGCP, getSignedFileUrl, uploadFileToGCP } from '../utilis/gcpStorage';
import { generatePOIWorkbook, POIReportRow, POIReportWorkbookData } from './poi-report-excel.helper';
import { deductionSections } from '../constants/tax-deduction-sections';

export type POIEligibilityStatus = 'NoDeclaration' | 'NoApplicableInvestments' | 'MissingProofs' | 'PendingApproval' | 'Rejected' | 'Eligible';

export interface POIEligibility {
    eligible: boolean;
    status: POIEligibilityStatus;
    reasons: string[];
}

const validFinancialYear = (value: string): boolean => {
    const match = /^(\d{4})-(\d{4})$/.exec(value);
    return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
};

const safeReportFilePart = (value: unknown, fallback: string): string => {
    const sanitized = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 80);
    return sanitized || fallback;
};

const poiReportFileName = (
    user: { name?: string; employeeCode?: string } | null | undefined,
    employeeId: string,
    financialYear: string,
    version: number,
): string => {
    const employeeName = safeReportFilePart(user?.name, 'Employee');
    const employeeCode = safeReportFilePart(user?.employeeCode || employeeId, employeeId);
    return `POI_${employeeName}_${employeeCode}_FY${safeReportFilePart(financialYear, 'Unknown')}_v${version}.xlsx`;
};

const humanize = (value: unknown): string => String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();

const sectionLabel = (sectionId: unknown): string => {
    const normalizedId = String(sectionId || '');
    return deductionSections.find((section) => section.id === normalizedId)?.title || humanize(normalizedId);
};

const reportRemark = (review: any): string => {
    const comment = String(review?.comments || '').trim();
    return /^(approved|verified)$/i.test(comment) ? '' : comment;
};

export class POIReportService extends BaseService {
    evaluateEligibility(taxDeclaration: any | null): POIEligibility {
        if (!taxDeclaration) return { eligible: false, status: 'NoDeclaration', reasons: ['Tax declaration not found'] };

        const allDeclarations = taxDeclaration.declarations || [];
        const normalizedStatus = (item: any): string => String(item?.status || '').trim().toLowerCase();

        // A rejected POI anywhere in the declaration blocks the entire report,
        // including inconsistent/legacy records whose amount was later cleared.
        const rejected = allDeclarations.filter((item: any) => normalizedStatus(item) === 'rejected');
        const declarationRejected = String(taxDeclaration.poiSubmissionStatus || '').trim().toLowerCase() === 'rejected';
        if (declarationRejected || rejected.length) {
            const reasons = rejected.map((item: any) => `${humanize(item.subSection || item.section)} is rejected`);
            return {
                eligible: false,
                status: 'Rejected',
                reasons: reasons.length ? reasons : ['Proof of investment declaration is rejected'],
            };
        }

        const declarations = allDeclarations.filter((item: any) => Math.abs(Number(item.declaredAmount || 0)) > 0);
        if (!declarations.length) {
            return { eligible: false, status: 'NoApplicableInvestments', reasons: ['No non-zero investment declarations found'] };
        }

        const missingProofs = declarations.filter((item: any) => !(item.documents || []).some((document: any) => document.isLatestVersion === true));
        if (missingProofs.length) {
            return { eligible: false, status: 'MissingProofs', reasons: missingProofs.map((item: any) => `${humanize(item.subSection)} does not have a current proof`) };
        }
        const unapproved = declarations.filter((item: any) => normalizedStatus(item) !== 'verified');
        if (unapproved.length) {
            return { eligible: false, status: 'PendingApproval', reasons: unapproved.map((item: any) => `${humanize(item.subSection || item.section)} is awaiting approval`) };
        }
        return { eligible: true, status: 'Eligible', reasons: [] };
    }

    buildFingerprint(taxDeclaration: any): string {
        const declarations = (taxDeclaration.declarations || [])
            .filter((item: any) => Math.abs(Number(item.declaredAmount || 0)) > 0)
            .map((item: any) => ({
                section: item.section,
                subSection: item.subSection,
                declaredAmount: Number(item.declaredAmount || 0),
                verifiedAmount: Number(item.verifiedAmount || 0),
                status: item.status,
                documents: (item.documents || [])
                    .filter((document: any) => document.isLatestVersion === true)
                    .map((document: any) => ({ name: document.documentName, path: document.documentPath, uploadedAt: document.uploadDate }))
                    .sort((left: any, right: any) => String(left.path).localeCompare(String(right.path))),
            }))
            .sort((left: any, right: any) => `${left.section}:${left.subSection}`.localeCompare(`${right.section}:${right.subSection}`));
        return createHash('sha256').update(JSON.stringify({
            declarationId: String(taxDeclaration._id),
            financialYear: taxDeclaration.financialYear,
            regime: taxDeclaration.regime,
            declarations,
        })).digest('hex');
    }

    private mapRows(taxDeclaration: any): POIReportRow[] {
        const approvedDeclarations = (taxDeclaration.declarations || [])
            .filter((item: any) => item.status === 'verified' && Math.abs(Number(item.declaredAmount || 0)) > 0);
        const configuredKeys = new Set<string>();

        const configuredRows = deductionSections.flatMap((section) =>
            section.subsections.map((subsection) => {
                const key = `${section.id}:${subsection.id}`;
                configuredKeys.add(key);
                const item = approvedDeclarations.find((declaration: any) =>
                    declaration.section === section.id && declaration.subSection === subsection.id);

                if (!item) {
                    return {
                        section: section.title,
                        description: subsection.name,
                        declaredAmount: 0,
                        approvedAmount: 0,
                        status: '' as const,
                        lenderName: '',
                        lenderPan: '',
                        remarks: '',
                        coveredMemberDetails: '',
                    };
                }

                const latestReview = (item.reviewHistory || []).slice().sort((left: any, right: any) =>
                    new Date(right.reviewDate || 0).getTime() - new Date(left.reviewDate || 0).getTime())[0];
                const coveredMembers = item.coveredMemberDetails || item.coveredMembers || '';
                return {
                    section: section.title,
                    description: subsection.name,
                    declaredAmount: Number(item.declaredAmount || 0),
                    approvedAmount: Number(item.verifiedAmount || 0),
                    status: 'APPROVED' as const,
                    lenderName: String(item.lenderName || item.lenderDetails?.name || ''),
                    lenderPan: String(item.lenderPan || item.lenderDetails?.pan || ''),
                    remarks: reportRemark(latestReview),
                    coveredMemberDetails: Array.isArray(coveredMembers) ? coveredMembers.join(', ') : String(coveredMembers),
                };
            }),
        );

        const additionalRows = approvedDeclarations
            .filter((item: any) => !configuredKeys.has(`${item.section}:${item.subSection}`))
            .map((item: any) => {
                const latestReview = (item.reviewHistory || []).slice().sort((left: any, right: any) =>
                    new Date(right.reviewDate || 0).getTime() - new Date(left.reviewDate || 0).getTime())[0];
                const coveredMembers = item.coveredMemberDetails || item.coveredMembers || '';
                return {
                    section: sectionLabel(item.section),
                    description: String(item.description || humanize(item.subSection)),
                    declaredAmount: Number(item.declaredAmount || 0),
                    approvedAmount: Number(item.verifiedAmount || 0),
                    status: 'APPROVED' as const,
                    lenderName: String(item.lenderName || item.lenderDetails?.name || ''),
                    lenderPan: String(item.lenderPan || item.lenderDetails?.pan || ''),
                    remarks: reportRemark(latestReview),
                    coveredMemberDetails: Array.isArray(coveredMembers) ? coveredMembers.join(', ') : String(coveredMembers),
                };
            });

        return [...configuredRows, ...additionalRows];
    }

    async getCandidateStatus(employeeId: string, financialYear: string): Promise<{ eligibility: POIEligibility; report: any | null }> {
        const [taxDeclaration, report] = await Promise.all([
            TaxDeclaration.findOne({ employeeId, financialYear }).lean(),
            Document.findOne({ employeeId, type: 'POIReport', 'metadata.poiReport.financialYear': financialYear }).lean(),
        ]);
        const eligibility = this.evaluateEligibility(taxDeclaration);
        if (taxDeclaration && report && report.metadata?.poiReport?.sourceFingerprint !== this.buildFingerprint(taxDeclaration)) {
            return { eligibility, report: { ...report, metadata: { ...report.metadata, poiReport: { ...report.metadata.poiReport, generationStatus: 'Outdated' } } } };
        }
        return { eligibility, report };
    }

    async getCandidateStatuses(employeeIds: string[], financialYear: string): Promise<Record<string, { eligibility: POIEligibility; report: any | null }>> {
        const objectIds = employeeIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
        const [declarations, reports] = await Promise.all([
            TaxDeclaration.find({ employeeId: { $in: objectIds }, financialYear }).lean(),
            Document.find({ employeeId: { $in: objectIds }, type: 'POIReport', 'metadata.poiReport.financialYear': financialYear }).lean(),
        ]);
        const declarationByEmployee = new Map(declarations.map((item: any) => [item.employeeId.toString(), item]));
        const reportByEmployee = new Map(reports.map((item: any) => [item.employeeId.toString(), item]));
        return Object.fromEntries(employeeIds.map((employeeId) => {
            const declaration: any = declarationByEmployee.get(employeeId) || null;
            const report: any = reportByEmployee.get(employeeId) || null;
            const eligibility = this.evaluateEligibility(declaration);
            const effectiveReport = declaration && report && report.metadata?.poiReport?.sourceFingerprint !== this.buildFingerprint(declaration)
                ? { ...report, metadata: { ...report.metadata, poiReport: { ...report.metadata.poiReport, generationStatus: 'Outdated' } } }
                : report;
            return [employeeId, { eligibility, report: effectiveReport }];
        }));
    }

    async markOutdatedForDeclaration(taxDeclaration: any, reason: string): Promise<void> {
        const fingerprint = this.buildFingerprint(taxDeclaration);
        await Document.updateOne({
            employeeId: taxDeclaration.employeeId,
            type: 'POIReport',
            'metadata.poiReport.financialYear': taxDeclaration.financialYear,
            'metadata.poiReport.sourceFingerprint': { $ne: fingerprint },
        }, {
            $set: {
                'metadata.poiReport.generationStatus': 'Outdated',
                'metadata.poiReport.outdatedAt': new Date(),
                'metadata.poiReport.outdatedReason': reason,
            },
        });
    }

    async generate(employeeId: string, financialYear: string, forceRegenerate = false): Promise<IDocument> {
        if (!Types.ObjectId.isValid(employeeId)) throw new Error('A valid employee ID is required');
        if (!validFinancialYear(financialYear)) throw new Error('Financial year must be a consecutive range in YYYY-YYYY format');
        if (!this.context.user?._id) throw new Error('Authenticated administrator is required');

        const [user, taxDeclaration] = await Promise.all([
            User.findById(employeeId).select('name employeeCode departmentId active').lean(),
            TaxDeclaration.findOne({ employeeId, financialYear }).lean(),
        ]);
        if (!user) throw new Error('Employee not found');
        if (!taxDeclaration) throw new Error(`Tax Declaration not found for FY ${financialYear}`);
        const eligibility = this.evaluateEligibility(taxDeclaration);
        if (!eligibility.eligible) throw new Error(`${eligibility.status}: ${eligibility.reasons.join('; ')}`);

        const fingerprint = this.buildFingerprint(taxDeclaration);
        const existingDocument = await Document.findOne({ employeeId, type: 'POIReport', 'metadata.poiReport.financialYear': financialYear });
        if (!forceRegenerate && existingDocument?.metadata?.poiReport?.sourceFingerprint === fingerprint && existingDocument.metadata.poiReport.generationStatus === 'Completed') {
            return existingDocument;
        }

        const rows = this.mapRows(taxDeclaration);
        const workbookData: POIReportWorkbookData = {
            employeeName: user.name,
            employeeCode: user.employeeCode || '',
            financialYear,
            regime: taxDeclaration.regime,
            rows,
        };
        const nextVersion = existingDocument ? Number(existingDocument.version || 1) + 1 : 1;
        const outputDirectory = path.join(process.cwd(), 'uploads');
        await fsPromises.mkdir(outputDirectory, { recursive: true });
        const fileName = poiReportFileName(user, employeeId, financialYear, nextVersion);
        const outputPath = path.join(outputDirectory, fileName);
        let uploadedFileUrl = '';

        try {
            await generatePOIWorkbook(workbookData, outputPath);
            const upload = await uploadFileToGCP({
                filePath: outputPath,
                fileName,
                employeeId,
                category: 'Tax',
                type: 'POIReport',
                cacheControl: 'no-store, max-age=0',
            });
            if (!upload.success || !upload.fileUrl) throw new Error(upload.error || 'POI report upload failed');
            uploadedFileUrl = upload.fileUrl;

            const generatedAt = new Date();
            const performedBy = new Types.ObjectId(this.context.user._id);
            const metadata = {
                poiReport: {
                    employeeId: new Types.ObjectId(employeeId),
                    financialYear,
                    taxDeclarationId: taxDeclaration._id,
                    regime: taxDeclaration.regime,
                    sourceFingerprint: fingerprint,
                    sourceUpdatedAt: taxDeclaration.updatedAt || generatedAt,
                    generationStatus: 'Completed',
                    generatedAt,
                    generatedBy: performedBy,
                    lastRegeneratedAt: existingDocument ? generatedAt : undefined,
                    generationError: '',
                    outdatedAt: undefined,
                    outdatedReason: '',
                    declarationCount: rows.length,
                    totalDeclaredAmount: rows.reduce((sum, item) => sum + item.declaredAmount, 0),
                    totalApprovedAmount: rows.reduce((sum, item) => sum + item.approvedAmount, 0),
                },
            };

            if (existingDocument) {
                const previousVersions = existingDocument.metadata?.poiReport?.previousVersions || [];
                previousVersions.push({
                    version: existingDocument.version || 1,
                    fileName: existingDocument.fileName,
                    filePath: existingDocument.filePath,
                    generatedAt: existingDocument.metadata?.poiReport?.generatedAt || existingDocument.uploadDate,
                    sourceFingerprint: existingDocument.metadata?.poiReport?.sourceFingerprint || '',
                });
                (metadata.poiReport as any).previousVersions = previousVersions.slice(-20);
                existingDocument.fileName = fileName;
                existingDocument.filePath = uploadedFileUrl;
                existingDocument.uploadDate = generatedAt;
                existingDocument.updatedBy = performedBy;
                existingDocument.version = nextVersion;
                existingDocument.metadata = metadata as any;
                existingDocument.auditLog ||= [];
                existingDocument.auditLog.push({ action: 'Re-Generate', performedBy, timestamp: generatedAt, details: `POI report re-generated for FY ${financialYear}` });
                return await existingDocument.save();
            }

            return await new Document({
                employeeId: new Types.ObjectId(employeeId),
                type: 'POIReport',
                category: 'Tax',
                tags: ['POIReport', financialYear],
                fileName,
                filePath: uploadedFileUrl,
                uploadDate: generatedAt,
                uploadedBy: performedBy,
                updatedBy: performedBy,
                accessLevel: 'Private',
                status: 'Generated',
                version: 1,
                metadata,
                auditLog: [{ action: 'Generate', performedBy, timestamp: generatedAt, details: `POI report generated for FY ${financialYear}` }],
            }).save();
        } catch (error) {
            if (uploadedFileUrl) await deleteFileFromGCP(uploadedFileUrl).catch(() => undefined);
            throw error;
        } finally {
            await fsPromises.unlink(outputPath).catch(() => undefined);
        }
    }

    async regenerate(documentId: string): Promise<IDocument> {
        if (!Types.ObjectId.isValid(documentId)) throw new Error('A valid POI report ID is required');
        const document = await Document.findOne({ _id: documentId, type: 'POIReport' }).lean();
        if (!document) throw new Error('POI report not found');
        const financialYear = document.metadata.poiReport?.financialYear;
        if (!financialYear) throw new Error('POI report financial year is missing');
        return this.generate(document.employeeId.toString(), financialYear, true);
    }

    async getDetails(documentId: string): Promise<any> {
        if (!Types.ObjectId.isValid(documentId)) throw new Error('A valid POI report ID is required');
        const document = await Document.findOne({ _id: documentId, type: 'POIReport' })
            .populate('employeeId', 'name email employeeCode departmentId active')
            .populate('uploadedBy', 'name email')
            .lean();
        if (!document) throw new Error('POI report not found');
        const declarationId = document.metadata.poiReport?.taxDeclarationId;
        if (!declarationId) throw new Error('POI report declaration reference is missing');
        const declaration = await TaxDeclaration.findById(declarationId).lean();
        return { document, eligibility: this.evaluateEligibility(declaration), rows: declaration ? this.mapRows(declaration) : [] };
    }

    async getDownload(documentId: string): Promise<{ url: string; fileName: string }> {
        if (!Types.ObjectId.isValid(documentId)) throw new Error('A valid POI report ID is required');
        const document = await Document.findOne({ _id: documentId, type: 'POIReport' }).lean();
        if (!document) throw new Error('POI report not found');
        const employee = await User.findById(document.employeeId).select('name employeeCode').lean();
        const fileName = poiReportFileName(
            employee,
            document.employeeId.toString(),
            document.metadata.poiReport?.financialYear || 'Unknown',
            Number(document.version || 1),
        );
        return { url: await getSignedFileUrl(document.filePath, { downloadFileName: fileName }), fileName };
    }
}
