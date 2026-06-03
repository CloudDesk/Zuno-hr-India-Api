import { Types } from "mongoose";
import { ISalaryAssignment, SalaryAssignment } from "../models/salary-assignments.model";
import { SalaryStructure } from "../models/salary-structure.model";
import { BaseService } from "./base.service";
import { RequestContext } from "../types/context";
import { getCurrentFinancialYear } from "../utilis/dates";
import { TaxDeclaration } from "../models/tax-declaration";
import { ITaxDeclarationUpdate, TaxDeclarationService } from "./tax-declaration.service";

export interface IVoluntaryPf {
    enabled: boolean;
    employeeContributionType: 'percentage' | 'fixed';
    employeeContributionPercentage: number;
    employeeContributionValue: number;
}

export interface ISalaryAssignmentCreate {
    employeeId: Types.ObjectId;
    monthlyGross: number;
    annualInsurance: number;
    reimbursement: number;
    travelAllowance?: number; // ✅ Optional travel allowance (default: 0)
    airTicketAllowance?: number; // ✅ NEW: Optional air ticket allowance (default: 0)
    medicalAllowance?: number; // ✅ NEW: Optional medical allowance (default: 0)
    voluntaryPf?: IVoluntaryPf;
    salaryStructureId: Types.ObjectId
    isActive: Boolean;
    effectiveFrom: Date;
    effectiveTo: Date;
}

export interface ISalaryAssignmentUpdate {
    _id: Types.ObjectId;
    employeeId: Types.ObjectId;
    monthlyGross: number;
    annualInsurance: number;
    reimbursement: number;
    travelAllowance?: number; // ✅ Optional travel allowance (default: 0)
    airTicketAllowance?: number; // ✅ NEW: Optional air ticket allowance (default: 0)
    medicalAllowance?: number; // ✅ NEW: Optional medical allowance (default: 0)
    voluntaryPf?: IVoluntaryPf;
    salaryStructureId: Types.ObjectId
    isActive: Boolean;
    effectiveFrom: Date;
    effectiveTo: Date;
}

export class SalaryAssignmentService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    private async calculateAssignedBasic(monthlyGross: number, salaryStructureId: Types.ObjectId): Promise<number> {
        const salaryStructure = await SalaryStructure.findById(salaryStructureId).lean();
        if (!salaryStructure) {
            throw new Error('Salary structure not found');
        }

        const basicPercentage = Number(salaryStructure.fixedEarnings?.basicPercentage ?? 0);
        return Math.round((basicPercentage / 100) * Number(monthlyGross || 0));
    }

    private async normalizeVoluntaryPf(
        data: ISalaryAssignmentCreate | ISalaryAssignmentUpdate,
        existingAssignment?: ISalaryAssignment
    ): Promise<void> {
        const incomingVoluntaryPf = data.voluntaryPf;
        const existingVoluntaryPf = existingAssignment?.voluntaryPf;

        if (!incomingVoluntaryPf && !existingVoluntaryPf) {
            return;
        }

        const voluntaryPf: IVoluntaryPf = {
            enabled: incomingVoluntaryPf?.enabled ?? existingVoluntaryPf?.enabled ?? false,
            employeeContributionType:
                incomingVoluntaryPf?.employeeContributionType ?? existingVoluntaryPf?.employeeContributionType ?? 'percentage',
            employeeContributionPercentage:
                incomingVoluntaryPf?.employeeContributionPercentage ?? existingVoluntaryPf?.employeeContributionPercentage ?? 0,
            employeeContributionValue:
                incomingVoluntaryPf?.employeeContributionValue ?? existingVoluntaryPf?.employeeContributionValue ?? 0,
        };

        if (!voluntaryPf.enabled) {
            data.voluntaryPf = {
                ...voluntaryPf,
                employeeContributionPercentage: 0,
                employeeContributionValue: 0,
            };
            return;
        }

        if (!['percentage', 'fixed'].includes(voluntaryPf.employeeContributionType)) {
            throw new Error('Invalid voluntary PF contribution type');
        }

        if (voluntaryPf.employeeContributionPercentage < 0 || voluntaryPf.employeeContributionValue < 0) {
            throw new Error('Voluntary PF contribution cannot be negative');
        }

        const monthlyGross = Number(data.monthlyGross ?? existingAssignment?.monthlyGross ?? 0);
        const salaryStructureId = data.salaryStructureId ?? existingAssignment?.salaryStructureId;

        if (!salaryStructureId) {
            throw new Error('Salary structure is required to calculate voluntary PF');
        }

        const assignedBasic = await this.calculateAssignedBasic(monthlyGross, salaryStructureId);

        if (voluntaryPf.employeeContributionType === 'percentage') {
            voluntaryPf.employeeContributionValue = Math.round(
                (voluntaryPf.employeeContributionPercentage / 100) * assignedBasic
            );
        } else {
            if (assignedBasic <= 0 && voluntaryPf.employeeContributionValue > 0) {
                throw new Error('Cannot calculate voluntary PF percentage without assigned basic');
            }

            voluntaryPf.employeeContributionPercentage = assignedBasic > 0
                ? Number(((voluntaryPf.employeeContributionValue / assignedBasic) * 100).toFixed(2))
                : 0;
            voluntaryPf.employeeContributionValue = Math.round(voluntaryPf.employeeContributionValue);
        }

        data.voluntaryPf = voluntaryPf;
    }

    async create(data: ISalaryAssignmentCreate): Promise<ISalaryAssignment> {

        const hasOverlap = await this.isDateOverlap(
            data.employeeId,
            data.effectiveFrom,
            data.effectiveTo
        );
        if (hasOverlap) {
            throw new Error('Salary assignment dates overlap with an existing record.');
        }

        if (data.isActive) {
            await SalaryAssignment.updateMany(
                { employeeId: data.employeeId, isActive: true },
                { isActive: false }
            );
        }
        await this.normalizeVoluntaryPf(data);
        const salaryAssignment = new SalaryAssignment(data);
        const savedAssignment = await salaryAssignment.save();

        // Trigger tax declaration update for the current financial year
        const financialYear = getCurrentFinancialYear();
        const taxDeclaration = await TaxDeclaration.findOne({
            employeeId: data.employeeId,
            financialYear
        });
        if (taxDeclaration) {
            // Check for migration adjustment
            if (taxDeclaration.isMigrationAdjusted) {
                console.warn(
                    `[MIGRATION WARNING] Salary assignment created for migration-adjusted employee ${data.employeeId}. ` +
                    `Annual tax will be recalculated, but monthly deductions will NOT be redistributed.`
                );
            }

            const taxDeclarationService = new TaxDeclarationService(this.context);
            const taxUpdateData: ITaxDeclarationUpdate = {
                _id: taxDeclaration._id.toString(),
                employeeId: data.employeeId.toString(),
                financialYear: taxDeclaration.financialYear,
                regime: taxDeclaration.regime,
                declarations: taxDeclaration.declarations.map((decl: any) => ({
                    ...decl,
                    subsection: decl.subsection ?? null // or provide a sensible default value
                })),
                cessRate: taxDeclaration.cessRate,
                annualGross: 0, // Will be recalculated in TaxDeclarationService
                totalDeclaredAmount: taxDeclaration.totalDeclaredAmount,
                totalVerifiedAmount: taxDeclaration.totalVerifiedAmount,
                standardDeduction: taxDeclaration.standardDeduction,
                ptDeduction: taxDeclaration.ptDeduction || 0,
                calculatedTaxAmount: taxDeclaration.calculatedTaxAmount,
                revisedTaxAmount: taxDeclaration.revisedTaxAmount,
                taxPaid: taxDeclaration.taxPaid,
                poiSubmissionStatus: taxDeclaration.poiSubmissionStatus,
                reviewHistory: taxDeclaration.reviewHistory?.map((item: any) => ({
                    reviewedBy: item.reviewedBy?.toString(),
                    reviewDate: item.reviewDate instanceof Date ? item.reviewDate.toISOString() : item.reviewDate,
                    action: item.action,
                    comments: item.comments
                })),
                isLocked: taxDeclaration.isLocked,
                initialTaxBreakdown: taxDeclaration.initialTaxBreakdown,
                isDeclared: taxDeclaration.isDeclared,
                isPOISubmitted: taxDeclaration.isPOISubmitted,
                isResubmitted: taxDeclaration.isResubmitted,
                previousTaxAmount: taxDeclaration.previousTaxAmount,
                taxAdjustmentRequired: taxDeclaration.taxAdjustmentRequired,
                adjustmentAmount: taxDeclaration.adjustmentAmount,
                adjustmentReason: taxDeclaration.adjustmentReason,
                monthlyAdjustment: taxDeclaration.monthlyAdjustment,
                remainingMonths: taxDeclaration.remainingMonths,
                adjustmentDistribution: taxDeclaration.adjustmentDistribution,
                lastAdjustmentDate: taxDeclaration.lastAdjustmentDate,
                excessTaxPaid: taxDeclaration.excessTaxPaid,
                noFurtherTaxDeduction: taxDeclaration.noFurtherTaxDeduction,
                remainingTaxToPay: taxDeclaration.remainingTaxToPay,
                monthlyDeductions: taxDeclaration.monthlyDeductions,
                salaryAssignments: (taxDeclaration.salaryAssignments ?? []).map((item: any) => ({
                    assignmentId: item.assignmentId instanceof Types.ObjectId ? item.assignmentId : item.assignmentId?._id ?? item.assignmentId,
                    validFrom: item.validFrom instanceof Date ? item.validFrom : new Date(item.validFrom),
                    validTill: item.validTill ? (item.validTill instanceof Date ? item.validTill : new Date(item.validTill)) : null,
                    monthlyGross: typeof item.monthlyGross === 'number' ? item.monthlyGross : Number(item.monthlyGross),
                    isActive: typeof item.isActive === 'boolean' ? item.isActive : Boolean(item.isActive)
                }))
            };
            await taxDeclarationService.update(taxUpdateData);
        }

        return savedAssignment;
    }

    async update(data: ISalaryAssignmentUpdate): Promise<ISalaryAssignment> {

        const hasOverlap = await this.isDateOverlap(
            data.employeeId,
            data.effectiveFrom,
            data.effectiveTo,
            data._id // To avoid falsely detect that the current record overlaps with itself.
        );
        if (hasOverlap) {
            throw new Error('Salary assignment dates overlap with an existing record.');
        }

        const salaryAssignment = await SalaryAssignment.findById(data._id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        // Deactivate other active assignments if this one is set to active
        if (data.isActive) {
            await SalaryAssignment.updateMany(
                { employeeId: data.employeeId, isActive: true, _id: { $ne: data._id } },
                { isActive: false }
            );
        }

        await this.normalizeVoluntaryPf(data, salaryAssignment);
        Object.assign(salaryAssignment, data);
        const updatedAssignment = await salaryAssignment.save();
        // Trigger tax declaration update for the current financial year
        if (!data.isActive) {
            return updatedAssignment; // If not active, no need to update tax declaration
        }
        const financialYear = getCurrentFinancialYear();
        const taxDeclaration = await TaxDeclaration.findOne({
            employeeId: data.employeeId,
            financialYear
        });
        console.log(taxDeclaration, "taxDeclaration in update method")
        if (taxDeclaration) {
            // Check for migration adjustment
            if (taxDeclaration.isMigrationAdjusted) {
                console.warn(
                    `[MIGRATION WARNING] Salary assignment updated for migration-adjusted employee ${data.employeeId}. ` +
                    `Annual tax will be recalculated, but monthly deductions will NOT be redistributed.`
                );
            }

            const taxDeclarationService = new TaxDeclarationService(this.context);
            const taxUpdateData: ITaxDeclarationUpdate = {
                _id: taxDeclaration._id.toString(),
                employeeId: data.employeeId.toString(),
                financialYear: taxDeclaration.financialYear,
                regime: taxDeclaration.regime,
                declarations: taxDeclaration.declarations.map((decl: any) => ({
                    ...decl,
                    subsection: decl.subsection ?? null // or provide a sensible default value
                })),
                cessRate: taxDeclaration.cessRate,
                annualGross: 0, // Will be recalculated in TaxDeclarationService
                totalDeclaredAmount: taxDeclaration.totalDeclaredAmount,
                totalVerifiedAmount: taxDeclaration.totalVerifiedAmount,
                standardDeduction: taxDeclaration.standardDeduction,
                ptDeduction: taxDeclaration.ptDeduction || 0,
                calculatedTaxAmount: taxDeclaration.calculatedTaxAmount,
                revisedTaxAmount: taxDeclaration.revisedTaxAmount,
                taxPaid: taxDeclaration.taxPaid,
                poiSubmissionStatus: taxDeclaration.poiSubmissionStatus,
                reviewHistory: taxDeclaration.reviewHistory?.map((item: any) => ({
                    reviewedBy: item.reviewedBy?.toString(),
                    reviewDate: item.reviewDate instanceof Date ? item.reviewDate.toISOString() : item.reviewDate,
                    action: item.action,
                    comments: item.comments
                })),
                isLocked: taxDeclaration.isLocked,
                initialTaxBreakdown: taxDeclaration.initialTaxBreakdown,
                isDeclared: taxDeclaration.isDeclared,
                isPOISubmitted: taxDeclaration.isPOISubmitted,
                isResubmitted: taxDeclaration.isResubmitted,
                previousTaxAmount: taxDeclaration.previousTaxAmount,
                taxAdjustmentRequired: taxDeclaration.taxAdjustmentRequired,
                adjustmentAmount: taxDeclaration.adjustmentAmount,
                adjustmentReason: taxDeclaration.adjustmentReason,
                monthlyAdjustment: taxDeclaration.monthlyAdjustment,
                remainingMonths: taxDeclaration.remainingMonths,
                adjustmentDistribution: taxDeclaration.adjustmentDistribution,
                lastAdjustmentDate: taxDeclaration.lastAdjustmentDate,
                excessTaxPaid: taxDeclaration.excessTaxPaid,
                noFurtherTaxDeduction: taxDeclaration.noFurtherTaxDeduction,
                remainingTaxToPay: taxDeclaration.remainingTaxToPay,
                monthlyDeductions: taxDeclaration.monthlyDeductions
            };
            await taxDeclarationService.update(taxUpdateData);
        }

        return updatedAssignment;
    }

    async delete(id: Types.ObjectId): Promise<ISalaryAssignment> {
        const salaryAssignment = await SalaryAssignment.findById(id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        await salaryAssignment.deleteOne();

        // Trigger tax declaration update after deletion
        const financialYear = getCurrentFinancialYear();
        const taxDeclaration = await TaxDeclaration.findOne({
            employeeId: salaryAssignment.employeeId,
            financialYear
        });
        if (taxDeclaration) {
            const taxDeclarationService = new TaxDeclarationService(this.context);
            const taxUpdateData: ITaxDeclarationUpdate = {
                _id: taxDeclaration._id.toString(),
                employeeId: salaryAssignment.employeeId.toString(),
                financialYear: taxDeclaration.financialYear,
                regime: taxDeclaration.regime,
                declarations: taxDeclaration.declarations.map((decl: any) => ({
                    ...decl,
                    subsection: decl.subsection ?? null // or provide a sensible default value
                })),
                cessRate: taxDeclaration.cessRate,
                annualGross: 0, // Will be recalculated in TaxDeclarationService
                totalDeclaredAmount: taxDeclaration.totalDeclaredAmount,
                totalVerifiedAmount: taxDeclaration.totalVerifiedAmount,
                standardDeduction: taxDeclaration.standardDeduction,
                ptDeduction: taxDeclaration.ptDeduction || 0,
                calculatedTaxAmount: taxDeclaration.calculatedTaxAmount,
                revisedTaxAmount: taxDeclaration.revisedTaxAmount,
                taxPaid: taxDeclaration.taxPaid,
                poiSubmissionStatus: taxDeclaration.poiSubmissionStatus,
                reviewHistory: taxDeclaration.reviewHistory?.map((item: any) => ({
                    reviewedBy: item.reviewedBy?.toString(),
                    reviewDate: item.reviewDate instanceof Date ? item.reviewDate.toISOString() : item.reviewDate,
                    action: item.action,
                    comments: item.comments
                })),
                isLocked: taxDeclaration.isLocked,
                initialTaxBreakdown: taxDeclaration.initialTaxBreakdown,
                isDeclared: taxDeclaration.isDeclared,
                isPOISubmitted: taxDeclaration.isPOISubmitted,
                isResubmitted: taxDeclaration.isResubmitted,
                previousTaxAmount: taxDeclaration.previousTaxAmount,
                taxAdjustmentRequired: taxDeclaration.taxAdjustmentRequired,
                adjustmentAmount: taxDeclaration.adjustmentAmount,
                adjustmentReason: taxDeclaration.adjustmentReason,
                monthlyAdjustment: taxDeclaration.monthlyAdjustment,
                remainingMonths: taxDeclaration.remainingMonths,
                adjustmentDistribution: taxDeclaration.adjustmentDistribution,
                lastAdjustmentDate: taxDeclaration.lastAdjustmentDate,
                excessTaxPaid: taxDeclaration.excessTaxPaid,
                noFurtherTaxDeduction: taxDeclaration.noFurtherTaxDeduction,
                remainingTaxToPay: taxDeclaration.remainingTaxToPay,
                monthlyDeductions: taxDeclaration.monthlyDeductions
            };
            await taxDeclarationService.update(taxUpdateData);
        }
        return salaryAssignment;
    }

    async findAll(): Promise<ISalaryAssignment[]> {
        return SalaryAssignment.find();
    }

    async findById(id: Types.ObjectId): Promise<ISalaryAssignment> {
        const salaryAssignment = await SalaryAssignment.findById(id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        return salaryAssignment;
    }

    async findByUserId(userId: Types.ObjectId): Promise<ISalaryAssignment[]> {
        return SalaryAssignment.find({ employeeId: userId })
    }

    async findActiveByUserId(userId: Types.ObjectId): Promise<ISalaryAssignment | null> {
        return SalaryAssignment.findOne({ employeeId: userId, isActive: true });
    }

    private async isDateOverlap(
        employeeId: Types.ObjectId,
        from: Date,
        to: Date,
        excludeId?: Types.ObjectId
    ): Promise<boolean> {
        const query: any = {
            employeeId,
            ...(excludeId && { _id: { $ne: excludeId } }),
            $or: [
                {
                    effectiveFrom: { $lte: to },
                    effectiveTo: { $gte: from }
                },
                {
                    effectiveFrom: { $lte: from },
                    effectiveTo: { $gte: from }
                },
                {
                    effectiveFrom: { $lte: to },
                    effectiveTo: { $gte: to }
                }
            ]
        };

        // Optional: if you want to ignore inactive ones, uncomment the below:
        // query.isActive = true;

        const overlappingAssignment = await SalaryAssignment.findOne(query);
        return !!overlappingAssignment;
    }


}

/*
export class SalaryAssignmentService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    async create(data: ISalaryAssignmentCreate): Promise<ISalaryAssignment> {
        const salaryAssignment = new SalaryAssignment(data);
        return salaryAssignment.save();
    }

    async update(data: ISalaryAssignmentUpdate): Promise<ISalaryAssignment> {
        const salaryAssignment = await SalaryAssignment.findById(data._id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        Object.assign(salaryAssignment, data);
        return salaryAssignment.save();
    }

    async delete(id: Types.ObjectId): Promise<ISalaryAssignment> {
        const salaryAssignment = await SalaryAssignment.findById(id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        await salaryAssignment.deleteOne();
        return salaryAssignment;
    }

    async findAll(): Promise<ISalaryAssignment[]> {
        return SalaryAssignment.find();
    }

    async findById(id: Types.ObjectId): Promise<ISalaryAssignment> {
        const salaryAssignment = await SalaryAssignment.findById(id);
        if (!salaryAssignment) {
            throw new Error('Salary Assignment not found');
        }
        return salaryAssignment;
    }

    async findByUserId(userId: Types.ObjectId): Promise<ISalaryAssignment[]> {
        return SalaryAssignment.find({ employeeId: userId })
    }

    async findActiveByUserId(userId: Types.ObjectId): Promise<ISalaryAssignment | null> {
        return SalaryAssignment.findOne({ employeeId: userId, isActive: true });
    }
}
     */
