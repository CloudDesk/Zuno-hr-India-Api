import { Types } from "mongoose";
import { ITaxDeclaration, TaxDeclaration } from "../models/tax-declaration";
import { getCurrentFinancialYear } from "../utilis/dates";
import { ITaxSlab, TaxSlab } from "../models/tax-slab.model";
import { IUser, SalaryAssignment, User } from "../models";
// import { ISalaryAssignmentUpdate } from "./salary-assignment.service";
import { BaseService } from "./base.service";
import { RequestContext } from "../types/context";
import fs from 'fs';
import path from 'path';
import { Document } from "../models/document.model";

export interface ITaxDeclarationCreate {
    employeeId: string;
    financialYear: string;
    regime: 'new' | 'old';
}
export interface IDocument {
    documentName: string;
    documentPath: string;
    uploadData: string;
    isLatestVersion: boolean;
}

export interface IDeclaration {
    section: string;
    subsection: string;
    maxLimit: number;
    declaredAmount: number;
    verifiedAmount: number;
    status: "pending" | "verified" | "rejected" | "resubmission_requested" | "document_submitted";
    documents?: IDocument[];
    _id?: Types.ObjectId;
}

export interface ISlabwiseTax {
    slab: string;
    amount: number;
    fromAmount: number;
    toAmount?: number | null;
}

export interface ITaxBreakdown {
    taxAmount: number;
    slabwiseTax: ISlabwiseTax[];
    cessAmount: number;
    totalTaxAmount: number;
    taxableIncome: number;
    rebateAmount: number;
    isRebateApplicable: boolean;
    marginalReliefAmount: number;
    isMarginalReliefApplicable: boolean;
    taxWithCess: number; // Tax before Form12B TDS deduction
    form12bTDSAmount?: number;
    finalTaxWithCess: number;
}
export interface IForm12BInput {
    form12bId: string;
    tdsAmount: number;
    financialYear: string;
}

export interface IMonthlyTaxDeduction {
    month: string;              // e.g., "Apr", "May", etc.
    financialYear: string;               // 2023-2024
    plannedDeduction: number;   // Original planned deduction
    actualDeduction: number;    // What was actually deducted
    adjustmentAmount: number;   // Any adjustment applied this month
    plannedDate: Date;        // When the deduction occurred
    isProcessed: boolean;       // Whether this month's deduction has been processed
}

export interface ITaxDeclarationUpdate {
    _id: Types.ObjectId | string;
    employeeId: string;
    financialYear: string;
    regime: 'new' | 'old';
    declarations: IDeclaration[];
    cessRate: number;
    annualGross: number;
    totalDeclaredAmount: number;
    totalVerifiedAmount: number;
    standardDeduction: number;
    calculatedTaxAmount: number;
    revisedTaxAmount: number;
    taxPaid: number;

    poiSubmissionStatus: "not_submitted" | "submitted" | "verified" | "rejected" | "resubmission";
    reviewHistory?: {
        reviewedBy: string;
        reviewDate: string;
        action: "verified" | "rejected" | "resubmission_requested";
        comments: string;
    }[];
    isLocked: boolean;
    initialTaxBreakdown: ITaxBreakdown;
    isDeclared: boolean;
    isPOISubmitted: boolean;
    isResubmitted: boolean;
    previousTaxAmount: number;

    taxAdjustmentRequired: boolean;
    adjustmentAmount: number;
    adjustmentReason: string;
    monthlyAdjustment: number;
    remainingMonths: number;
    adjustmentDistribution: string;
    lastAdjustmentDate: Date | string;

    excessTaxPaid: number;
    noFurtherTaxDeduction: boolean;
    remainingTaxToPay: number;
    monthlyDeductions: IMonthlyTaxDeduction[];
    salaryAssignments?: { assignmentId: Types.ObjectId; validFrom: Date; validTill: Date; monthlyGross: number; isActive: boolean }[];

}

export class TaxDeclarationService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }
    private async calculateAnnualGross(employeeId: string, financialYear: string): Promise<{
        annualGross: number;
        salaryAssignments: { assignmentId: Types.ObjectId; validFrom: Date; validTill: Date; monthlyGross: number; isActive: boolean }[];
    }> {
        const [fyStartYear, fyEndYear] = financialYear.split('-').map(Number);
        const fyStartDate = new Date(`${fyStartYear}-04-01T00:00:00.000Z`);
        const fyEndDate = new Date(`${fyEndYear}-03-31T23:59:59.999Z`);

        const salaryAssignments = await SalaryAssignment.find({
            employeeId,
            effectiveFrom: { $lte: fyEndDate },
            effectiveTo: { $gte: fyStartDate }
        }).sort('effectiveFrom');
        if (!salaryAssignments.length) {
            throw new Error('No salary assignments found for the financial year');
        }
        let annualGross = 0;
        const assignmentsForTaxDeclaration: { assignmentId: Types.ObjectId; validFrom: Date; validTill: Date; monthlyGross: number; isActive: boolean }[] = [];
        for (const assignment of salaryAssignments) {
            const startDate = new Date(Math.max(assignment.effectiveFrom.getTime(), fyStartDate.getTime()));
            const endDate = new Date(Math.min(assignment.effectiveTo.getTime(), fyEndDate.getTime()));
            const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1;
            annualGross += Number(assignment.monthlyGross) * Number(months);
            assignmentsForTaxDeclaration.push({
                assignmentId: assignment._id,
                validFrom: startDate,
                validTill: endDate,
                monthlyGross: Number(assignment.monthlyGross),
                isActive: !!assignment.isActive
            });
        }
        return { annualGross, salaryAssignments: assignmentsForTaxDeclaration };
    }

    // * user/admin chooses regime Creates a new tax declaration with initial calculations
    async create(data: ITaxDeclarationCreate): Promise<ITaxDeclaration> {
        console.log(data, "0 data")
        const { employeeId, regime, financialYear } = data;
        // 1. Get current FY tax slab
        const taxSlab = await TaxSlab.findOne({
            financialYear,
            regime,
            isActive: true
        }) as ITaxSlab | null;
        console.log(taxSlab, "1 taxSlab");
        if (!taxSlab) {
            throw new Error(`Tax slab not found for FY ${financialYear} and regime ${regime}`);
        }
        /*
                // 2. Get employee's salary details
                const salaryAssignment = await SalaryAssignment.findOne({
                    employeeId,
                    isActive: true
                }) as ISalaryAssignmentUpdate | null;
                console.log(salaryAssignment, "2 salaryAssignment");
                if (!salaryAssignment) {
                    throw new Error('Active salary assignment not found');
                }
        */
        //calculate the user Joining Date and allow make isForm12BApplicable value
        //fetch the user

        const user: IUser = await User.findById(employeeId).select('name joiningDate');
        if (!user) {
            throw new Error('User not found');
        }
        console.log(user, "getUser")
        const [fyStartYear, fyEndYear] = financialYear.split('-').map(Number);
        const fyStartDate = new Date(`${fyStartYear}-04-01T00:00:00.000Z`);
        const fyEndDate = new Date(`${fyEndYear}-03-31T23:59:59.999Z`);
        const joiningDate = new Date(user.joiningDate);
        const isForm12BApplicable = joiningDate >= fyStartDate && joiningDate <= fyEndDate;
        console.log(isForm12BApplicable, 'isForm12BApplicable');

        const { annualGross, salaryAssignments } = await this.calculateAnnualGross(employeeId, financialYear);


        // 3. Calculate annual gross income
        // const annualGross = (Number(salaryAssignment?.monthlyGross) ?? 0) * 12;
        console.log(annualGross, "3.1 annualGross");

        // 4. Convert tax slabs to plain objects for calculation
        const plainSlabs = taxSlab.slabs.map(slab => ({
            fromAmount: Number(slab.fromAmount),
            toAmount: slab.toAmount !== null ? Number(slab.toAmount) : null,
            taxRate: Number(slab.taxRate)
        }));
        console.log(plainSlabs, "4 plain slabs for calculation");

        // 5. Calculate initial tax
        const initialTax = await this.calculateIncomeTax(
            annualGross,
            regime,
            0, // No declarations yet
            0, // No verified amounts yet
            taxSlab.standardDeduction,
            plainSlabs,
            taxSlab.cessRate
        );
        console.log(initialTax, "5 initialTax");
        // 6. Create monthly deduction plan based on FY months
        const monthlyDeductions = await this.createMonthlyDeductionPlan(
            financialYear,
            initialTax.finalTaxWithCess
        );
        console.log(monthlyDeductions, "6 monthlyDeductions");

        // 7. Create tax declaration
        const taxDeclaration = new TaxDeclaration({
            employeeId,
            financialYear,
            regime,
            standardDeduction: taxSlab.standardDeduction,
            declarations: [],
            totalDeclaredAmount: 0,
            totalVerifiedAmount: 0,
            totalDeclinedAmount: 0,
            annualGross,
            calculatedTaxAmount: initialTax.taxAmount,//SBT
            revisedTaxAmount: initialTax.totalTaxAmount, // SBT after rebate/marginal relief
            remainingTaxToPay: initialTax.finalTaxWithCess,//Final tax with cess
            previousTaxAmount: initialTax.totalTaxAmount,
            initialTaxBreakdown: initialTax,
            initialTaxCalculated: true,
            lastDeclarationDate: new Date(),
            initialDeclarationDate: new Date(),
            // Initialize additional fields for old regime
            monthlyDeductions,
            poiSubmissionStatus: regime === 'old' ? 'not_submitted' : undefined,
            cessRate: taxSlab.cessRate,
            isLocked: false,
            salaryAssignments,
            isForm12BApplicable
        });

        console.log(taxDeclaration, "7 taxDeclaration");
        // 8. Calculate number of remaining months in FY for tax distribution
        const remainingMonths = this.calculateRemainingMonthsInFY(financialYear);
        taxDeclaration.remainingMonths = remainingMonths;

        console.log(remainingMonths, "8 remainingMonths");
        console.log(taxDeclaration, "8.1 taxDeclaration");

        await taxDeclaration.save();

        return taxDeclaration;
    }

    //declaration decclrerd by user
    async update(data: ITaxDeclarationUpdate): Promise<ITaxDeclaration> {
        // 1. Find the tax declaration document
        const taxDeclaration = await TaxDeclaration.findById(data._id);
        if (!taxDeclaration) {
            throw new Error('Tax Declaration not found');
        }
        console.log(taxDeclaration, "1 taxDeclaration get")
        const { employeeId, regime, financialYear } = data;
        // 2. Get current FY tax slab
        const taxSlab = await TaxSlab.findOne({
            financialYear,
            regime,
            isActive: true
        }) as ITaxSlab | null;
        if (!taxSlab) {
            throw new Error(`Tax slab not found for FY ${financialYear} and regime ${regime}`);
        }
        console.log(taxSlab, "2 taxSlab");

        // update the correct standard deduction and cess rate
        taxDeclaration.standardDeduction = taxSlab.standardDeduction;
        taxDeclaration.cessRate = taxSlab.cessRate;
        console.log(taxDeclaration, "2.1 taxDeclaration updated with taxSlab");

        /* 
        // 3. Get employee's salary details
         const salaryAssignment = await SalaryAssignment.findOne({
             employeeId,
             isActive: true
         }) as ISalaryAssignmentUpdate | null;
         console.log(salaryAssignment, "3 salaryAssignment");
 
         // 4. Calculate annual gross income
         const annualGross = (Number(salaryAssignment?.monthlyGross) ?? 0) * 12;
         console.log(annualGross, "4 annualGross");
 */
        const { annualGross, salaryAssignments } = await this.calculateAnnualGross(employeeId, financialYear);


        // 5. Convert tax slabs to plain objects for calculation
        const plainSlabs = taxSlab.slabs.map(slab => ({
            fromAmount: Number(slab.fromAmount),
            toAmount: slab.toAmount !== null ? Number(slab.toAmount) : null,
            taxRate: Number(slab.taxRate)
        }));
        console.log(plainSlabs, "5 plain slabs for calculation");


        // 6. Calculate total declared amount from declarations
        let totalDeclaredAmount = 0
        // If declarations array exists and has elements, calculate totalDeclaredAmount
        if (data.declarations && data.declarations.length > 0) {
            totalDeclaredAmount = data.declarations.reduce((sum, declaration) => {
                // Ensure declaredAmount is a number, default to 0 if undefined or invalid
                const amount = Number(declaration.declaredAmount) || 0;
                return sum + amount;
            }, 0);
            data.totalDeclaredAmount = totalDeclaredAmount;
            data.isDeclared = true;
        } else {
            data.isDeclared = false;
        }

        console.log(data, "6 taxDeclaration updated")
        // 7. Store previous tax amount for comparison
        const previousTaxAmount = taxDeclaration.initialTaxBreakdown.finalTaxWithCess || 0;
        data.previousTaxAmount = previousTaxAmount;
        console.log(data, "7 taxDeclaration updated")

        // 8. Calculate new tax based on declarations
        const updatedTax = await this.calculateIncomeTax(
            annualGross,
            regime,
            totalDeclaredAmount,
            taxDeclaration.totalVerifiedAmount || 0,
            taxSlab.standardDeduction,
            plainSlabs,
            taxSlab.cessRate
        );
        console.log(updatedTax, "8 updatedTax");

        // Apply Form12B TDS if applicable
        if (taxDeclaration.isForm12BApplicable && taxDeclaration.form12B) {
            const docForm12B = await Document.findById(taxDeclaration.form12B);
            if (docForm12B && docForm12B.type === 'Form12B' && docForm12B.metadata?.form12B?.status === 'Verified') {
                updatedTax.form12bTDSAmount = docForm12B.metadata.form12B.tdsDeducted || 0;
                updatedTax.taxWithCess = updatedTax.finalTaxWithCess;
                updatedTax.finalTaxWithCess = Math.max(0, updatedTax.taxWithCess - updatedTax.form12bTDSAmount);
            }
        }
        data.calculatedTaxAmount = updatedTax.taxAmount; //SBT
        data.revisedTaxAmount = updatedTax.finalTaxWithCess;// After rebate/relief and cess
        data.initialTaxBreakdown = updatedTax;

        data.annualGross = annualGross;
        data.salaryAssignments = salaryAssignments;
        console.log(data, "9 after update data")

        // 10. Calculate tax adjustment if needed
        if (previousTaxAmount !== updatedTax.finalTaxWithCess) {
            data.taxAdjustmentRequired = true;
            data.adjustmentAmount = updatedTax.finalTaxWithCess - previousTaxAmount;
            data.adjustmentReason = data.declarations.length > 0 ? 'revised_declaration' : 'salary_revision';
            data.lastAdjustmentDate = new Date();

            // 11. Calculate remaining months for adjustment
            const remainingMonths = this.calculateRemainingMonthsInFY(financialYear);
            data.remainingMonths = remainingMonths;

            // 12. Calculate monthly adjustment amount
            if (remainingMonths > 0) {
                data.monthlyAdjustment = Math.round(data.adjustmentAmount / remainingMonths);
            } else {
                // If no months remain, set to full amount for one-time adjustment
                data.monthlyAdjustment = data.adjustmentAmount;
                data.adjustmentDistribution = 'one_time';
            }
            console.log(data, "10 after update data")
            const newObj = await this.updateMonthlyDeductionPlan(
                taxDeclaration.monthlyDeductions,
                updatedTax.finalTaxWithCess,
                remainingMonths,
                data.adjustmentAmount < 0
            );
            console.log(newObj, "10 newObj");
            data.monthlyDeductions = newObj;
        }
        console.log(previousTaxAmount !== updatedTax.totalTaxAmount, "10.1 after update data")

        // 14. Check if refund is needed (negative adjustment)
        if (data.adjustmentAmount < 0) {
            data.noFurtherTaxDeduction = true;
            data.excessTaxPaid = Math.abs(data.adjustmentAmount);
        }
        console.log(data, "11 after update data")
        // 15. Update taxDeclaration object with new data
        // 15. Update remaining tax to pay
        data.remainingTaxToPay = updatedTax.finalTaxWithCess - (taxDeclaration.taxPaid || 0);


        // 15. Update taxDeclaration object with new data
        Object.assign(taxDeclaration, data);
        return taxDeclaration.save();
    }

    // Updates POI documents for tax declarations
    async updateDocuments(id: Types.ObjectId, request: any): Promise<ITaxDeclaration> {
        // 1. Find the tax declaration document
        const taxDeclaration = await TaxDeclaration.findById(id);
        if (!taxDeclaration) {
            throw new Error('Tax Declaration not found');
        }

        // 2. Get user info using employeeId
        const user = await User.findOne({ _id: taxDeclaration.employeeId });
        if (!user) {
            throw new Error('User not found for given employeeId');
        }

        const userCleanName = user.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');


        console.log("*******")
        console.log(request.file)
        console.log('********');
        console.log(request.files);
        console.log("*********")

        let files = request.files;

        console.log(taxDeclaration, "1 taxDeclaration")
        console.log(files, "1.1 files ")

        // 2. Process each uploaded file
        files.forEach((file: any) => {
            const [section, ...subSectionParts] = file.fieldname.split('_');
            const subSection = subSectionParts.join('_');
            const timestamp = Date.now();
            // const ext = path.extname(file.originalname);
            const newFileName = `Tax_Dec_${section}_${subSection}_${userCleanName}_${timestamp}`;
            const uploadDir = path.dirname(file.path);
            const newFilePath = path.join(uploadDir, newFileName);

            // Rename file on disk
            fs.renameSync(file.path, newFilePath);

            const fileUrl = `http://${request.headers.host}/${newFileName}`;

            console.log(section, subSection, "2.1 section, subsection ")
            console.log(fileUrl, "2.2 fileUrl")
            // 3. Find the matching declaration
            const declaration = taxDeclaration.declarations.find(
                (decl) => decl.section === section && decl.subSection === subSection
            );
            console.log(declaration, "3 declaration")
            if (declaration) {
                // 4. Mark all existing documents as not latest
                declaration.documents.forEach(doc => doc.isLatestVersion = false);
                console.log(declaration, "1 declaration")
                // 4.1 Add new document entry
                declaration.documents.push({
                    documentName: file.originalname,
                    documentPath: fileUrl,
                    uploadDate: new Date(),
                    isLatestVersion: true
                });
                // 6. Update declaration status
                declaration.lastUpdated = new Date(); // Update last modified timestamp
                declaration.status = 'document_submitted';

            }
            /*
                const [section, ...subSectionParts] = file.fieldname.split('_');
                const subSection = subSectionParts.join('_');
                const fileUrl = `http://${request.headers.host}/${file.filename}`;
    
                console.log(section, subSection, "2.1 section, subsection ")
                console.log(fileUrl, "2.2 fileUrl")
    
                // 3. Find the matching declaration
                const declaration = taxDeclaration.declarations.find(
                    (decl) => decl.section === section && decl.subSection === subSection
                );
                console.log(declaration, "3 declaration")
                if (declaration) {
                    // 4. Mark all existing documents as not latest
                    declaration.documents.forEach(doc => doc.isLatestVersion = false);
                    console.log(declaration, "1 declaration")
                    // 4.1 Add new document entry
                    declaration.documents.push({
                        documentName: file.originalname,
                        documentPath: fileUrl,
                        uploadDate: new Date(),
                        isLatestVersion: true
                    });
                    // 6. Update declaration status
                    declaration.lastUpdated = new Date(); // Update last modified timestamp
                    declaration.status = 'document_submitted';
                  
                }  */
        });
        console.log(taxDeclaration, "6 taxDeclaration");
        // 7. Update POI submission status
        taxDeclaration.poiSubmissionStatus = 'submitted';
        taxDeclaration.isPOISubmitted = true;
        // 8. Save and return updated document
        return await taxDeclaration.save();
    }

    //Admin review of declarations with approval/rejection handling
    async reviewDeclarations(id: Types.ObjectId, data: any): Promise<ITaxDeclaration> {
        // 1. Find the tax declaration document
        const taxDeclaration = await TaxDeclaration.findById(id);
        if (!taxDeclaration) {
            throw new Error('Tax Declaration not found');
        }
        const { approvedList, declinedList, userInfo, comments = {} } = data;
        console.log(approvedList, "approvedList", '**', declinedList, "declinedList")
        console.log(userInfo, "userInfo", comments, "comments")
        // Store previous tax for comparison and adjustment calculation
        const previousTaxAmount = taxDeclaration.revisedTaxAmount;
        taxDeclaration.previousTaxAmount = previousTaxAmount;

        // 2. Process approved declarations
        for (const subSection of approvedList) {
            const declaration = taxDeclaration.declarations.find(d => d.subSection === subSection);
            console.log(declaration, "each declaration approvedList")
            if (declaration) {
                declaration.status = 'verified';
                declaration.verifiedAmount = declaration.declaredAmount;
                declaration.reviewHistory.push({
                    reviewedBy: userInfo._id,
                    reviewDate: new Date(),
                    status: 'verified',
                    comments: comments && comments[subSection] ? comments[subSection] : "Approved"
                });
            }
        }
        // 3. Process declined declarations with resubmission logic

        let totalDeclinedAmount = taxDeclaration.totalDeclinedAmount || 0;

        for (const subSection of declinedList) {
            const declaration = taxDeclaration.declarations.find(d => d.subSection === subSection);
            console.log(declaration, "each declaration declinedList")
            if (declaration) {
                // Check resubmission status
                if (declaration.resubmissionInfo.isResubmitted) {
                    // Final rejection
                    declaration.status = "rejected";
                    declaration.verifiedAmount = 0;
                    taxDeclaration.poiSubmissionStatus = 'rejected';
                    declaration.resubmissionInfo.resubmissionAllowed = false;
                    declaration.resubmissionInfo.rejectionCount += 1;
                    totalDeclinedAmount += declaration.declaredAmount || 0;
                } else {
                    // First rejection, allow resubmission
                    declaration.status = "resubmission_requested";
                    declaration.verifiedAmount = 0;
                    declaration.resubmissionInfo.previouslyRejected = true;
                    declaration.resubmissionInfo.rejectionCount = 1;
                    declaration.resubmissionInfo.resubmissionAllowed = true;
                    declaration.resubmissionInfo.isResubmitted = true;

                    // Set resubmission deadline to 5 days from now
                    const resubmissionDeadline = new Date();
                    resubmissionDeadline.setDate(resubmissionDeadline.getDate() + 5);
                    declaration.resubmissionInfo.resubmissionDeadline = resubmissionDeadline;

                    // Update document status
                    taxDeclaration.poiSubmissionStatus = 'resubmission';
                    taxDeclaration.isResubmitted = true;
                    totalDeclinedAmount += declaration.declaredAmount || 0;
                }

                // Add review history
                declaration.reviewHistory.push({
                    reviewedBy: userInfo._id,
                    reviewDate: new Date(),
                    status: declaration.resubmissionInfo?.isResubmitted ? "rejected" : "resubmission_requested",
                    comments: comments && comments[subSection] ? comments[subSection] : "Rejected"
                });
            }
        }


        // 5. Update total declined amount
        taxDeclaration.totalDeclinedAmount = totalDeclinedAmount;

        // 4. Recalculate tax based on updated verifications
        let recalculatedTax = await this.recalculateTax(taxDeclaration.toObject() as ITaxDeclarationUpdate);
        console.log(recalculatedTax, "4 recalculatedTax")

        // 5. Update tax amounts and calculate adjustments
        taxDeclaration.calculatedTaxAmount = recalculatedTax.taxAmount;
        taxDeclaration.revisedTaxAmount = recalculatedTax.finalTaxWithCess;
        taxDeclaration.totalVerifiedAmount = recalculatedTax.totalVerifiedAmount;
        taxDeclaration.initialTaxBreakdown = recalculatedTax;

        // taxDeclaration.taxAdjustmentRequired = taxDeclaration.calculatedTaxAmount !== taxDeclaration.revisedTaxAmount;
        console.log(taxDeclaration, "5 taxdeclaration")
        // 6. Handle tax adjustment if needed
        if (previousTaxAmount !== recalculatedTax.finalTaxWithCess) {
            taxDeclaration.taxAdjustmentRequired = true;
            taxDeclaration.adjustmentAmount = recalculatedTax.finalTaxWithCess - previousTaxAmount;
            taxDeclaration.adjustmentReason = 'declarations_declined';
            taxDeclaration.lastAdjustmentDate = new Date();

            console.log(taxDeclaration, "6 taxdeclaration")

            // 7. Calculate remaining months for adjustment
            const remainingMonths = this.calculateRemainingMonthsInFY(taxDeclaration.financialYear);
            taxDeclaration.remainingMonths = remainingMonths;

            console.log(taxDeclaration, "7 taxdeclaration")

            // 8. Calculate monthly adjustment
            if (remainingMonths > 0) {
                taxDeclaration.monthlyAdjustment = Math.round(taxDeclaration.adjustmentAmount / remainingMonths);
            } else {
                // If no months remain, set for one-time adjustment
                taxDeclaration.monthlyAdjustment = taxDeclaration.adjustmentAmount;
                taxDeclaration.adjustmentDistribution = 'one_time';
            }
            console.log(taxDeclaration.monthlyAdjustment, "8 monthlyAdjustment", taxDeclaration.remainingMonths, "8 remainingMonths")

            // 9. Update monthly deduction plan
            // const monthlyDeductions = await this.updateMonthlyDeductionPlan(
            //     taxDeclaration.monthlyDeductions,
            //     taxDeclaration.monthlyAdjustment,
            //     taxDeclaration.remainingMonths,      
            //     taxDeclaration.adjustmentAmount < 0
            // );
            const monthlyDeductions = await this.updateMonthlyDeductionPlan(
                taxDeclaration.monthlyDeductions,
                recalculatedTax.finalTaxWithCess,
                taxDeclaration.remainingMonths,
                taxDeclaration.adjustmentAmount < 0
            );

            taxDeclaration.monthlyDeductions = monthlyDeductions
            console.log(monthlyDeductions, "9 monthlyDeductions")
            // 10. Calculate remaining tax to pay
            taxDeclaration.remainingTaxToPay = taxDeclaration.revisedTaxAmount - (taxDeclaration.taxPaid || 0);

            // 11. Handle excess tax paid scenario
            if (taxDeclaration.remainingTaxToPay < 0) {
                taxDeclaration.excessTaxPaid = Math.abs(taxDeclaration.remainingTaxToPay);

                // If significant excess, stop further deductions
                if (taxDeclaration.excessTaxPaid > taxDeclaration.revisedTaxAmount * 0.25) {
                    taxDeclaration.noFurtherTaxDeduction = true;
                }
            }
        }
        console.log(taxDeclaration, "11 taxDeclaration");
        // return taxDeclaration;
        return await taxDeclaration.save();
    }

    //Form12B Integration Re-calculation Tax
    async processForm12BTDS(input: IForm12BInput): Promise<ITaxDeclaration> {
        console.log("processForm12BTDS called with input:", input);
        const { form12bId, tdsAmount, financialYear } = input;

        // 1. Find the tax declaration for the given financial year
        const taxDeclaration = await TaxDeclaration.findOne({
            financialYear,
            form12B: new Types.ObjectId(form12bId),
            isForm12BApplicable: true
        });
        console.log(taxDeclaration, "1 taxDeclaration for Form12B")

        if (!taxDeclaration) {
            throw new Error(`Tax Declaration not found for FY ${financialYear} with Form12B ID ${form12bId} or Form12B is not applicable`);
        }

        // 2. Verify regime is old
        if (taxDeclaration.regime !== 'old') {
            throw new Error('Form12B TDS processing is only applicable for old regime');
        }

        // 3. Update initialTaxBreakdown with form12bTDSAmount
        const initialTaxBreakdown = taxDeclaration.initialTaxBreakdown;
        initialTaxBreakdown.form12bTDSAmount = tdsAmount;
        initialTaxBreakdown.taxWithCess = initialTaxBreakdown.finalTaxWithCess;
        initialTaxBreakdown.finalTaxWithCess = Math.max(0, initialTaxBreakdown.taxWithCess - tdsAmount);
        taxDeclaration.revisedTaxAmount = initialTaxBreakdown.finalTaxWithCess;
        taxDeclaration.remainingTaxToPay = initialTaxBreakdown.finalTaxWithCess - (taxDeclaration.taxPaid || 0);
        taxDeclaration.previousTaxAmount = initialTaxBreakdown.taxWithCess;
        taxDeclaration.taxAdjustmentRequired = true;
        taxDeclaration.adjustmentAmount = initialTaxBreakdown.finalTaxWithCess - initialTaxBreakdown.taxWithCess;
        taxDeclaration.adjustmentReason = 'form12b_tds_adjustment';
        taxDeclaration.lastAdjustmentDate = new Date();


        console.log(taxDeclaration, "5 taxDeclaration after Form12B processing")
        // 6. Calculate remaining months
        const remainingMonths = this.calculateRemainingMonthsInFY(financialYear);
        console.log(remainingMonths, "6 remainingMonths after Form12B processing")
        taxDeclaration.remainingMonths = remainingMonths;

        // 7. Calculate monthly adjustment
        if (remainingMonths > 0) {
            taxDeclaration.monthlyAdjustment = Math.round(taxDeclaration.adjustmentAmount / remainingMonths);
        } else {
            taxDeclaration.monthlyAdjustment = taxDeclaration.adjustmentAmount;
            taxDeclaration.adjustmentDistribution = 'one_time';
        }

        // 8. Update monthly deduction plan
        const monthlyDeductions = await this.updateMonthlyDeductionPlan(
            taxDeclaration.monthlyDeductions,
            initialTaxBreakdown.finalTaxWithCess,
            remainingMonths,
            taxDeclaration.adjustmentAmount < 0
        );
        console.log(monthlyDeductions, "8 monthlyDeductions after Form12B processing")
        taxDeclaration.monthlyDeductions = monthlyDeductions;

        if (taxDeclaration.remainingTaxToPay < 0) {
            taxDeclaration.excessTaxPaid = Math.abs(taxDeclaration.remainingTaxToPay);
            if (taxDeclaration.excessTaxPaid > taxDeclaration.revisedTaxAmount * 0.25) {
                taxDeclaration.noFurtherTaxDeduction = true;
            }
        }
        console.log(taxDeclaration.excessTaxPaid, "8.1 excessTaxPaid after Form12B processing")
        // 9. Save and return updated tax declaration
        return await taxDeclaration.save();
    }

    async delete(id: Types.ObjectId): Promise<ITaxDeclaration> {
        const taxDeclaration = await TaxDeclaration.findById(id);
        if (!taxDeclaration) {
            throw new Error('Tax Declaration not found');
        }

        await taxDeclaration.deleteOne();
        return taxDeclaration;
    }

    // Bulk update isForm12BApplicable for migration purposes
    // This is a one-time admin operation to enable Form12B for existing employees
    async bulkEnableForm12B(data: {
        employeeIds: string[];
        financialYear: string;
    }): Promise<{
        success: boolean;
        updated: number;
        failed: string[];
        details: Array<{ employeeId: string; status: string; message?: string }>;
    }> {
        const { employeeIds, financialYear } = data;
        const results: Array<{ employeeId: string; status: string; message?: string }> = [];
        let updatedCount = 0;
        const failedEmployees: string[] = [];

        console.log(`Bulk enabling Form12B for FY: ${financialYear}, Employee IDs:`, employeeIds);

        for (const employeeId of employeeIds) {
            try {
                // Find tax declaration for this employee and FY
                const taxDeclaration = await TaxDeclaration.findOne({
                    employeeId: new Types.ObjectId(employeeId),
                    financialYear
                });

                if (!taxDeclaration) {
                    results.push({
                        employeeId,
                        status: 'failed',
                        message: `Tax declaration not found for FY ${financialYear}`
                    });
                    failedEmployees.push(employeeId);
                    continue;
                }

                // Update the flag
                taxDeclaration.isForm12BApplicable = true;
                await taxDeclaration.save();

                results.push({
                    employeeId,
                    status: 'success',
                    message: 'Form12B enabled successfully'
                });
                updatedCount++;

            } catch (error: any) {
                results.push({
                    employeeId,
                    status: 'error',
                    message: error.message
                });
                failedEmployees.push(employeeId);
            }
        }

        return {
            success: updatedCount > 0,
            updated: updatedCount,
            failed: failedEmployees,
            details: results
        };
    }

    // Bulk create tax declarations for migration purposes
    // Checks for existing records and creates only for employees without existing declarations
    async bulkCreateTaxDeclarations(data: {
        employeeIds: string[];
        financialYear: string;
        regime: 'new' | 'old';
    }): Promise<{
        success: boolean;
        created: number;
        skipped: number;
        failed: number;
        skippedEmployees: string[];
        failedEmployees: string[];
        details: Array<{ employeeId: string; status: string; message?: string }>;
    }> {
        const { employeeIds, financialYear, regime } = data;
        const results: Array<{ employeeId: string; status: string; message?: string }> = [];
        let createdCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        const skippedEmployees: string[] = [];
        const failedEmployees: string[] = [];

        console.log(`Bulk creating tax declarations for FY: ${financialYear}, Regime: ${regime}, Employee IDs:`, employeeIds);

        for (const employeeId of employeeIds) {
            try {
                // Check if tax declaration already exists for this employee and FY
                const existingDeclaration = await TaxDeclaration.findOne({
                    employeeId: new Types.ObjectId(employeeId),
                    financialYear
                });

                if (existingDeclaration) {
                    results.push({
                        employeeId,
                        status: 'skipped',
                        message: `Tax declaration already exists for FY ${financialYear}`
                    });
                    skippedEmployees.push(employeeId);
                    skippedCount++;
                    continue;
                }

                // Create tax declaration using existing create method
                await this.create({
                    employeeId,
                    financialYear,
                    regime
                });

                results.push({
                    employeeId,
                    status: 'success',
                    message: 'Tax declaration created successfully'
                });
                createdCount++;

            } catch (error: any) {
                results.push({
                    employeeId,
                    status: 'failed',
                    message: error.message
                });
                failedEmployees.push(employeeId);
                failedCount++;
            }
        }

        return {
            success: createdCount > 0,
            created: createdCount,
            skipped: skippedCount,
            failed: failedCount,
            skippedEmployees,
            failedEmployees,
            details: results
        };
    }

    async findAll(query: { page?: number; limit?: number; search?: string }):
        Promise<{
            taxDeclarations: ITaxDeclaration[],
            meta: { page: number, limit: number, total: number, totalPages: number }
        }> {
        const { page = 1, limit = 10, search } = query;
        const skip = (page - 1) * limit;
        console.log(query, "query")
        console.log(page, limit, search, "*****")
        const filter: any = {};
        if (search) {
            filter.regime = { $regex: search, $options: 'i' }; // Case-insensitive search
        }

        const [taxDeclarations, total] = await Promise.all([
            TaxDeclaration.find(filter).skip(skip).limit(limit),
            TaxDeclaration.countDocuments(filter),
        ]);

        return {
            taxDeclarations,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async findById(id: Types.ObjectId): Promise<ITaxDeclaration> {
        const taxDeclaration = await TaxDeclaration.findById(id);
        if (!taxDeclaration) {
            throw new Error('Tax Declaration not found');
        }
        return taxDeclaration;
    }

    async getUserCurrentFY(userId: Types.ObjectId): Promise<ITaxDeclaration | null> {
        try {
            const currentFY = getCurrentFinancialYear();
            console.log(`Fetching tax declaration for User: ${userId}, FY: ${currentFY}`);

            const taxDeclaration = await TaxDeclaration.findOne({
                employeeId: userId,
                financialYear: currentFY,
            });

            if (!taxDeclaration) {
                console.warn(`No tax declaration found for User: ${userId} in FY: ${currentFY}`);
                return null;
            }
            return taxDeclaration;
        } catch (error: any) {
            console.error(`Error fetching tax declaration: ${error.message}`);
            throw new Error('Failed to fetch tax declaration');
        }
    }



    //inial calculation when record is created
    private async calculateIncomeTax(
        annualGross: number,
        regime: 'old' | 'new',
        declaredInvestments: number = 0,
        verifiedInvestments: number = 0,
        standardDeduction: number = 50000,
        taxSlabs: { fromAmount: number; toAmount: number | null; taxRate: number }[],
        cessRate: number = 4
    ): Promise<ITaxBreakdown> {
        console.log("Input parameters:");
        console.log("annualGross:", annualGross);
        console.log("regime:", regime);
        console.log("declaredInvestments:", declaredInvestments);
        console.log("verifiedInvestments:", verifiedInvestments);
        console.log("standardDeduction:", standardDeduction);
        console.log("taxSlabs:", taxSlabs);

        // Calculate taxable income based on regime
        const useInvestments = regime === 'old'
            ? (verifiedInvestments > 0 ? verifiedInvestments : declaredInvestments)
            : 0;
        console.log("useInvestments:", useInvestments);

        const taxableIncome = annualGross - standardDeduction - useInvestments;
        console.log("calculatedTaxableIncome:", taxableIncome);

        // Early return if no taxable income
        if (taxableIncome <= 0) {
            console.log("No taxable income, returning zeros");
            return {
                taxAmount: 0,
                slabwiseTax: [],
                cessAmount: 0,
                totalTaxAmount: 0,
                taxableIncome,
                rebateAmount: 0,
                isRebateApplicable: false,
                marginalReliefAmount: 0,
                isMarginalReliefApplicable: false,
                taxWithCess: 0,
                finalTaxWithCess: 0,
                form12bTDSAmount: 0
            };
        }

        // Sort slabs by fromAmount
        const sortedSlabs = [...taxSlabs].sort((a, b) => a.fromAmount - b.fromAmount);
        console.log("Sorted slabs:", JSON.stringify(sortedSlabs, null, 2));

        let totalTax = 0;
        const slabwiseTax: ISlabwiseTax[] = [];

        // Process each slab
        // Calculate Slab-Based Tax (SBT)
        for (const slab of sortedSlabs) {

            console.log(slab, "slab in sortedSlabs")
            const { fromAmount, toAmount, taxRate } = slab;
            // Skip this slab if taxable income is below its range
            if (taxableIncome <= fromAmount) continue;

            // Determine the taxable amount in this slab
            let taxableAmountInSlab = 0;

            if (toAmount === null) {
                // This is the highest slab with no upper limit
                taxableAmountInSlab = taxableIncome - fromAmount;
                console.log(`Highest slab, taxable amount = ${taxableIncome} - ${fromAmount} = ${taxableAmountInSlab}`);
            } else {
                taxableAmountInSlab = taxableIncome <= toAmount ? taxableIncome - fromAmount : toAmount - fromAmount;
                console.log(`Income within slab, taxable amount = ${taxableIncome} - ${fromAmount} = ${taxableAmountInSlab}`);
            }
            // Calculate tax for this slab
            const taxForSlab = Math.round(taxableAmountInSlab * (taxRate / 100));
            totalTax += taxForSlab;

            // Format slab description
            const slabDesc = `${fromAmount} to ${toAmount === null ? 'above' : toAmount}`;
            // Add to slabwise tax breakdown
            slabwiseTax.push({ slab: slabDesc, amount: taxForSlab, fromAmount, toAmount });
        }
        console.log(taxableIncome, totalTax, "taxableIncome, totalTax")
        console.log(cessRate, taxSlabs, "cessRate, taxSlabs");
        console.log(slabwiseTax, "taxSlabs in calculateIncomeTax")
        const {
            rebateAmount,
            isRebateApplicable,
            marginalReliefAmount,
            isMarginalReliefApplicable,
            totalTaxAmount,
            cessAmount,
            taxWithCess
        } = this.calculateRebateAndRelief(regime, taxableIncome, totalTax, cessRate, taxSlabs, slabwiseTax);

        const result = {
            taxAmount: totalTax, //SBT
            slabwiseTax,
            cessAmount,
            totalTaxAmount, // SBT after rebate/marginal relief
            taxableIncome: Math.round(taxableIncome),
            rebateAmount,
            isRebateApplicable,
            marginalReliefAmount,
            isMarginalReliefApplicable,
            taxWithCess,
            finalTaxWithCess: taxWithCess,
            form12bTDSAmount: 0
        };

        console.log("Final result:", JSON.stringify(result, null, 2));
        return result;
    }


    //recalculate tax when Admin verify declaration amount
    private async recalculateTax(taxDeclaration: ITaxDeclarationUpdate): Promise<ITaxBreakdown & { totalVerifiedAmount: number }> {
        const { financialYear, regime, annualGross, standardDeduction, declarations } = taxDeclaration;

        // 1. Get current FY tax slab
        const taxSlab = await TaxSlab.findOne({
            financialYear,
            regime,
            isActive: true
        }) as ITaxSlab | null;
        if (!taxSlab) {
            throw new Error(`Tax slab not found for FY ${taxDeclaration.financialYear} and regime ${regime}`);
        }
        console.log(taxSlab, "1 taxSlab");

        // Convert the Mongoose slab documents to plain objects for calculation
        const plainSlabs = taxSlab.slabs.map(slab => ({
            fromAmount: Number(slab.fromAmount),
            toAmount: slab.toAmount !== null ? Number(slab.toAmount) : null,
            taxRate: Number(slab.taxRate)
        }));
        console.log(plainSlabs, "3.2 plain slabs for calculation");

        // Calculate total verified amount
        const totalVerifiedAmount = declarations
            .filter(d => d.status === "verified")
            .reduce((sum, d) => sum + d.verifiedAmount, 0);

        // Calculate tax with rebate and marginal relief
        const taxBreakdown = await this.calculateIncomeTax(
            annualGross,
            regime,
            taxDeclaration.totalDeclaredAmount,
            totalVerifiedAmount,
            standardDeduction,
            plainSlabs,
            taxSlab.cessRate
        );

        return { ...taxBreakdown, totalVerifiedAmount };
    }

    private calculateRebateAndRelief(
        regime: 'old' | 'new',
        taxableIncome: number,
        totalTax: number,
        cessRate: number,
        taxSlabs: { fromAmount: number; toAmount: number | null; taxRate: number }[],
        slabwiseTax: ISlabwiseTax[]
    ): Pick<ITaxBreakdown, 'rebateAmount' | 'isRebateApplicable' | 'marginalReliefAmount' | 'isMarginalReliefApplicable' | 'totalTaxAmount' | 'cessAmount' | 'taxWithCess'> {
        let rebateAmount = 0;
        let isRebateApplicable = false;
        let marginalReliefAmount = 0;
        let isMarginalReliefApplicable = false;
        let totalTaxAmount = totalTax;
        console.log(slabwiseTax, "slabwiseTax in calculateRebateAndRelief")
        // Define rebate thresholds and marginal relief base
        const rebateThreshold = regime === 'old' ? 12500 : 60000;
        const marginalReliefBase = regime === 'old' ? 500000 : 1200000;

        // Calculate the marginal relief upper limit dynamically
        let marginalReliefUpperLimit = marginalReliefBase;
        const sortedSlabs = [...taxSlabs].sort((a, b) => a.fromAmount - b.fromAmount);

        // Find the slab where marginal relief applies
        for (const slab of sortedSlabs) {
            if (slab.fromAmount >= marginalReliefBase && slab.taxRate > 0) {
                // Calculate taxable income where SBT = Excess Income + rebateThreshold
                const taxRate = slab.taxRate / 100;
                // SBT = BaseTax + taxRate * (TI - slab.fromAmount)
                // Excess = TI - marginalReliefBase
                // Set SBT = Excess + rebateThreshold
                // BaseTax + taxRate * (TI - slab.fromAmount) = (TI - marginalReliefBase) + rebateThreshold
                // Solve for TI
                const baseTax = sortedSlabs
                    .filter(s => s.fromAmount < slab.fromAmount && s.fromAmount < taxableIncome)
                    .reduce((sum, s) => {
                        const amount = s.toAmount ? Math.min(s.toAmount, taxableIncome) - s.fromAmount : taxableIncome - s.fromAmount;
                        return sum + amount * (s.taxRate / 100);
                    }, 0);
                const ti = (baseTax + marginalReliefBase + rebateThreshold - taxRate * slab.fromAmount) / (1 - taxRate);
                if (ti > slab.fromAmount && (!slab.toAmount || ti <= slab.toAmount)) {
                    marginalReliefUpperLimit = Math.round(ti);
                    break;
                }
            }
        }

        // Apply Rebate (87A(a)) and Marginal Relief (87A(b))
        if (regime === 'old') {
            // Rebate eligibility: SBT ≤ ₹12,500
            // if (totalTax <= rebateThreshold) {
            //     rebateAmount = totalTax;
            //     isRebateApplicable = true;
            //     totalTaxAmount = 0;
            // } else {
            //     // Marginal relief: TI between ₹5,00,001 and calculated upper limit
            //     const excessIncome = taxableIncome - marginalReliefBase;
            //     if (taxableIncome > marginalReliefBase && taxableIncome <= marginalReliefUpperLimit && totalTax > excessIncome) {
            //         marginalReliefAmount = totalTax - excessIncome;
            //         isMarginalReliefApplicable = true;
            //         totalTaxAmount = excessIncome;
            //     }
            // }
            // Rebate eligibility: Total income ≤ ₹5,00,000, up to ₹12,500
            if (taxableIncome <= marginalReliefBase && totalTax <= rebateThreshold) {
                rebateAmount = totalTax;
                isRebateApplicable = true;
                totalTaxAmount = 0;
            }
            // No marginal relief or rebate if total income > ₹5,00,000
        } else { // New regime
            // Rebate eligibility: SBT ≤ ₹60,000
            if (totalTax <= rebateThreshold) {
                rebateAmount = totalTax;
                isRebateApplicable = true;
                totalTaxAmount = 0;
            } else {
                // Marginal relief: TI between ₹12,00,001 and calculated upper limit
                const excessIncome = taxableIncome - marginalReliefBase;
                if (taxableIncome > marginalReliefBase && taxableIncome <= marginalReliefUpperLimit && totalTax > excessIncome) {
                    marginalReliefAmount = totalTax - excessIncome;
                    isMarginalReliefApplicable = true;
                    totalTaxAmount = excessIncome;
                }
            }
        }

        // Calculate cess and final tax
        const cessAmount = Math.round(totalTaxAmount * (cessRate / 100));

        const taxWithCess = totalTaxAmount + cessAmount;

        return {
            rebateAmount,
            isRebateApplicable,
            marginalReliefAmount,
            isMarginalReliefApplicable,
            totalTaxAmount,
            cessAmount,
            taxWithCess
        };
    }


    private async createMonthlyDeductionPlan(financialYear: string, totalTaxAmount: number, regimeMonth?: string) {

        console.log("createMonthlyDeductionPlan", financialYear, totalTaxAmount)
        const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

        // If regimeMonth is not provided, use current month
        let selectedMonth = regimeMonth;
        if (!selectedMonth) {
            const currentDate = new Date();
            const currentMonthIndex = currentDate.getMonth(); // 0-11 (Jan-Dec)

            // Convert calendar month to our financial year month format
            // Jan = 9, Feb = 10, Mar = 11, Apr = 0, May = 1, ..., Dec = 8
            let financialMonthIndex;
            if (currentMonthIndex <= 2) {
                // Jan (0) -> 9, Feb (1) -> 10, Mar (2) -> 11
                financialMonthIndex = currentMonthIndex + 9;
            } else {
                // Apr (3) -> 0, May (4) -> 1, ..., Dec (11) -> 8
                financialMonthIndex = currentMonthIndex - 3;
            }

            selectedMonth = months[financialMonthIndex];
        }

        // Validate that selected month is in the months array
        const startIndex = months.indexOf(selectedMonth);
        if (startIndex === -1) {
            throw new Error(`Invalid regime start month: ${selectedMonth}. Month must be one of: ${months.join(", ")}`);
        }

        // Number of months remaining from the selected month till March
        const remainingMonths = months.slice(startIndex);
        const monthCount = remainingMonths.length;

        // Divide tax amount among remaining months
        const monthlyDeduction = Math.floor(totalTaxAmount / monthCount);
        let remainingAmount = totalTaxAmount - (monthlyDeduction * monthCount);

        // Parse financial year for date calculations
        const [startYear, endYear] = financialYear.split('-').map(year => parseInt(year));

        const deductions = months.map((month, index) => {
            if (index < startIndex) {
                return {
                    month,
                    financialYear,
                    plannedDeduction: 0,
                    actualDeduction: 0,
                    adjustmentAmount: 0,
                    plannedDate: null,
                    isProcessed: false
                };
            }

            let adjustment = 0;
            if (remainingAmount > 0) {
                adjustment = 1;
                remainingAmount -= 1;
            }

            // Calculate correct plannedDate
            // For Apr-Dec: use startYear, for Jan-Mar: use endYear
            const year = (index <= 8) ? startYear : endYear; // 8 is index of Dec, 9 is index of Jan

            // Convert month index to calendar month (0-11 for Date constructor)
            // Apr (index 0) = calendar month 3, May (index 1) = calendar month 4, etc.
            let calendarMonth;
            if (index <= 8) {
                // Apr-Dec: 3-11
                calendarMonth = index + 3;
            } else {
                // Jan-Mar: 0-2
                calendarMonth = index - 9;
            }

            // Set to 2nd day of the month as required
            const plannedDate = new Date(year, calendarMonth, 2);

            return {
                month,
                financialYear,
                plannedDeduction: monthlyDeduction + adjustment,
                actualDeduction: monthlyDeduction + adjustment,
                adjustmentAmount: adjustment,
                plannedDate,
                isProcessed: false,
            };
        });

        return deductions;
    }

    private calculateRemainingMonthsInFY(financialYear: string) {
        const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

        const [startYear, endYear] = financialYear.split("-").map(Number);
        const fyStartDate = new Date(startYear, 3, 1); // April 1st of start year
        const fyEndDate = new Date(endYear, 2, 31); // March 31st of end year
        const today = new Date();

        // If today's date is before the FY start (upcoming FY) or after the FY end (past FY), return 0
        if (today < fyStartDate || today > fyEndDate) return 0;

        // Find the current month in the FY
        const currentMonthIndex = today.getMonth(); // 0-based index (Jan = 0, Apr = 3)
        const financialYearIndex = months.findIndex((_, i) => {
            return new Date(startYear, i + 3, 1).getMonth() === currentMonthIndex;
        });

        // Remaining months in the financial year (1 if today is in March)
        let remainingMonths = financialYearIndex >= 11 ? 1 : months.length - financialYearIndex;
        console.log(remainingMonths, "remainingMonths")
        return remainingMonths;
    }

    private async updateMonthlyDeductionPlan(
        monthlyDeductions: IMonthlyTaxDeduction[],
        newTotalTax: number,
        remainingMonths: number,
        isRefund: boolean
    ): Promise<IMonthlyTaxDeduction[]> {
        console.log(isRefund, "isRefund")
        // 1. Validate inputs
        if (remainingMonths <= 0 || !monthlyDeductions?.length) {
            return monthlyDeductions;
        }

        // 2. Define month order
        const monthOrder = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
        const targetMonth = monthOrder[monthOrder.length - remainingMonths];

        // 3. Find start index for adjustments
        const startIndex = monthlyDeductions.findIndex(m => m.month === targetMonth);
        if (startIndex === -1) {
            return monthlyDeductions;
        }

        // 4. Calculate total processed deductions
        const processedDeductions = monthlyDeductions
            .filter(m => m.isProcessed)
            .reduce((sum, m) => sum + (m.actualDeduction || 0), 0);

        // 5. Calculate remaining tax to distribute
        const remainingTax = Math.max(0, newTotalTax - processedDeductions);

        // 6. Count unprocessed months from startIndex
        const unprocessedMonths = monthlyDeductions.slice(startIndex).filter(m => !m.isProcessed);
        const unprocessedMonthCount = unprocessedMonths.length;
        if (unprocessedMonthCount === 0) {
            return monthlyDeductions;
        }

        // 7. Calculate new planned deduction per month
        const newPlannedDeduction = Math.floor(remainingTax / unprocessedMonthCount);
        let remainingAmount = remainingTax - (newPlannedDeduction * unprocessedMonthCount);

        // 8. Update unprocessed months
        for (let i = startIndex; i < monthlyDeductions.length; i++) {
            const month = monthlyDeductions[i];
            if (month.isProcessed) continue;

            // Assign new planned deduction
            const adjustment = remainingAmount > 0 ? 1 : 0;
            remainingAmount -= adjustment;
            month.plannedDeduction = newPlannedDeduction + adjustment;

            // Preserve actualDeduction (only update if explicitly needed, e.g., first update)
            if (month.actualDeduction === 0) {
                month.actualDeduction = month.plannedDeduction;
            }

            // Calculate adjustmentAmount as actualDeduction - plannedDeduction
            month.adjustmentAmount = month.actualDeduction - month.plannedDeduction;

            // Ensure plannedDate is set
            month.plannedDate = month.plannedDate || new Date();
        }

        return monthlyDeductions;
        /* console.log(isRefund, "isRefund")
         const monthOrder = [
             "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"
         ];
 
         // Find the starting index based on the remaining months count
         const targetMonth = monthOrder[monthOrder.length - remainingMonths];
         const startIndex = monthlyDeductions.findIndex(m => m.month === targetMonth);
 
         if (startIndex === -1) return monthlyDeductions; // If no valid start index, return original array
 
         // Update only the remaining months
         for (let i = startIndex; i < monthlyDeductions.length; i++) {
 
             monthlyDeductions[i].plannedDeduction += monthlyAdjustment;
             monthlyDeductions[i].adjustmentAmount = monthlyAdjustment;
             // monthlyDeductions[i].actualDeduction = monthlyAdjustment;
 
         }
 
         return monthlyDeductions;
         */
    }

}

// export const taxDeclarationService = new TaxDeclarationService();
