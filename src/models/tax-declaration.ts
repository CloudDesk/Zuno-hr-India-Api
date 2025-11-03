import { Schema, model, Document } from "mongoose";
interface ISlabwiseTax {
    slab: string;
    amount: number;
    fromAmount: number;
    toAmount?: number | null;
}
interface ITaxBreakdown {
    taxAmount: number; //SBT
    slabwiseTax: ISlabwiseTax[];
    cessAmount: number;
    totalTaxAmount: number; //taxAmount after the rebate/relief
    taxableIncome: number;
    rebateAmount: number; // Added for Rebate 87A(a)
    isRebateApplicable: boolean; // Flag for rebate eligibility
    marginalReliefAmount: number; // Added for Marginal Relief 87A(b)
    isMarginalReliefApplicable: boolean; // Flag for marginal relief eligibility
    taxWithCess: number; // Tax before Form12B TDS deduction
    form12bTDSAmount?: number; // TDS from Form12B
    finalTaxWithCess: number; // Final tax after rebate/relief, cess and Form 12B TDS

}
interface IDocument {
    documentName: string;
    documentPath: string;
    uploadDate: Date;
    isLatestVersion: boolean;
}
interface IMonthlyTaxDeduction {
    month: string;              // e.g., "Apr", "May", etc.
    financialYear: string;               // e.g., 2023, 2024
    plannedDeduction: number;   // Original planned deduction
    actualDeduction: number;    // What was actually deducted
    adjustmentAmount: number;   // Any adjustment applied this month
    plannedDate: Date;        // When the deduction occurred
    isProcessed: boolean;       // Whether this month's deduction has been processed
}
interface IDeclaration {
    section: string;          // "80C", "80D", etc.
    subSection: string;       // "Life Insurance", "Health Insurance", etc.
    maxLimit: number;         // Maximum allowed limit for this section/subsection
    limitType: "fixed" | "percentage" | "none";
    limitPercentage: number;
    description: string;      // Description of the declaration
    declaredAmount: number;
    verifiedAmount: number;
    status: "pending" | "verified" | "rejected" | "resubmission_requested" | "document_submitted";
    documents: IDocument[];
    reviewHistory: {
        reviewedBy: Schema.Types.ObjectId;
        reviewDate: Date;
        status: "verified" | "rejected" | "resubmission_requested";
        comments: string;
    }[];
    lastUpdated: Date;
    resubmissionInfo: {
        isResubmitted: boolean;      // Whether resubmission occurred
        resubmissionDeadline?: Date; // Deadline for resubmission
        previouslyRejected: boolean; // Whether it was previously rejected
        resubmissionAllowed: boolean; // Whether further resubmission is allowed
        rejectionCount: number;      // Count of rejections (max 2)
    };
}
export interface ITaxDeclaration extends Document {
    employeeId: Schema.Types.ObjectId;
    financialYear: string;
    regime: "old" | "new";
    declarations: IDeclaration[];
    cessRate: number;
    annualGross: number;
    totalDeclaredAmount: number;
    totalVerifiedAmount: number;
    totalDeclinedAmount: number;        // Track declined amounts separately
    standardDeduction: number;
    initialTaxCalculated: boolean;      // Track if initial tax was calculated

    // Tax amounts
    calculatedTaxAmount: number;        // Initial calculated tax
    revisedTaxAmount: number;           // Tax after verification/rejection
    previousTaxAmount: number;          // Tax amount before resubmission/last adjustment
    taxPaid: number;                    // Tax already paid so far
    remainingTaxToPay: number;          // Tax still to be deducted this FY

    // Adjustment tracking
    taxAdjustmentRequired: boolean;
    adjustmentAmount: number;       // Positive for additional tax, negative for refund
    adjustmentReason: "declarations_declined" | "declarations_approved" | "salary_revision" | "revised_declaration" | "form12b_tds_adjustment" | "other";
    monthlyAdjustment: number;      // Adjustment amount per remaining month
    remainingMonths: number;        // Number of months left for adjustment
    lastAdjustmentDate: Date;       // When adjustment was last calculated
    adjustmentDistribution: "equal" | "prorated" | "one_time"; // How to distribute adjustment

    // For handling mid-year declarations and adjustments
    initialDeclarationDate: Date;   // When first declaration was made
    lastDeclarationDate: Date;      // When last declaration was made
    monthlyDeductions: IMonthlyTaxDeduction[]; // Track deductions by month

    // For negative adjustments
    noFurtherTaxDeduction: boolean; // Flag when employee claims refund from govt
    excessTaxPaid: number;          // Track excess tax if any

    poiSubmissionStatus: "not_submitted" | "submitted" | "verified" | "rejected" | "resubmission";
    reviewHistory: [
        {
            reviewedBy: Schema.Types.ObjectId;
            reviewDate: Date;
            action: "verified" | "rejected" | "resubmission_requested";
            comments: string;
        }
    ];
    isLocked: boolean; // True when declaration window is closed
    initialTaxBreakdown: ITaxBreakdown;
    _id?: Schema.Types.ObjectId;
    isDeclared: boolean;
    isPOISubmitted: boolean;
    isResubmitted: boolean;   // Whether any declaration DOCS has been resubmitted
    form12B?: Schema.Types.ObjectId;
    salaryAssignments:
    {
        assignmentId: { type: Schema.Types.ObjectId, ref: 'SalaryAssignment' },
        validFrom: { type: Date, required: true },
        validTill: { type: Date },
        monthlyGross: { type: Number, required: true },
        isActive: { type: Boolean, default: false }
    }[],

    isForm12BApplicable: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}
const DocumentSchema = new Schema<IDocument>({
    documentName: { type: String, required: true },
    documentPath: { type: String, required: true },
    uploadDate: { type: Date, default: Date.now },
    isLatestVersion: { type: Boolean, default: true }
});
const MonthlyTaxDeductionSchema = new Schema<IMonthlyTaxDeduction>({
    month: { type: String, required: true },
    financialYear: { type: String, required: true },
    plannedDeduction: { type: Number, default: 0 },
    actualDeduction: { type: Number, default: 0 },
    adjustmentAmount: { type: Number, default: 0 },
    plannedDate: { type: Date },
    isProcessed: { type: Boolean, default: false }
});
const DeclarationSchema = new Schema<IDeclaration>({

    section: {
        type: String,
        required: true,
        enum: ["80C", "80D", "80E", "80G", "80TTA", "80GG", "80CCG", "80U", "80CCD2", "80RRB", "80DDB", "80CCD(1)", "80CCD(2)", "10(14)", "24(b)",
            "80EEA"
        ]
    },
    subSection: { type: String, required: true },
    maxLimit: { type: Number, required: true },
    limitType: {
        type: String,
        enum: ["fixed", "percentage", "none"],
        default: "fixed"
    },
    limitPercentage: { type: Number, required: false },
    description: { type: String },
    declaredAmount: { type: Number, default: 0 },
    verifiedAmount: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ["pending", "verified", "rejected", "resubmission_requested", "document_submitted"],
        default: "pending"
    },
    documents: [DocumentSchema],
    reviewHistory: [{
        reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reviewDate: { type: Date, default: Date.now },
        status: {
            type: String,
            enum: ["verified", "rejected", "resubmission_requested"]
        },
        comments: String
    }],
    lastUpdated: { type: Date, default: Date.now },
    resubmissionInfo: {
        isResubmitted: { type: Boolean, default: false },
        resubmissionDeadline: { type: Date },
        previouslyRejected: { type: Boolean, default: false },
        resubmissionAllowed: { type: Boolean, default: false },
        rejectionCount: { type: Number, default: 0 }
    }
});

const TaxDeclarationSchema = new Schema<ITaxDeclaration>({
    employeeId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    financialYear: { type: String, required: true },
    regime: { type: String, enum: ["old", "new"], required: true },
    declarations: [DeclarationSchema],
    annualGross: { type: Number, default: 0 },
    cessRate: { type: Number, default: 0 },
    totalDeclaredAmount: { type: Number, default: 0 },
    totalVerifiedAmount: { type: Number, default: 0 },
    totalDeclinedAmount: { type: Number, default: 0 },
    standardDeduction: { type: Number, required: true },
    initialTaxCalculated: { type: Boolean, default: false },

    // Tax amounts
    calculatedTaxAmount: { type: Number, default: 0 },
    revisedTaxAmount: { type: Number, default: 0 },
    previousTaxAmount: { type: Number, default: 0 },
    taxPaid: { type: Number, default: 0 },
    remainingTaxToPay: { type: Number, default: 0 },

    // Adjustment tracking
    taxAdjustmentRequired: { type: Boolean, default: false },
    adjustmentAmount: { type: Number, default: 0 },
    monthlyAdjustment: { type: Number, default: 0 },
    remainingMonths: { type: Number, default: 0 },
    lastAdjustmentDate: { type: Date },
    adjustmentReason: { type: String, enum: ["declarations_declined", "declarations_approved", "revised_declaration", "salary_revision", "form12b_tds_adjustment", "other"] },
    adjustmentDistribution: { type: String, enum: ["equal", "prorated", "one_time"], default: "equal" },

    // For handling mid-year declarations and adjustments
    initialDeclarationDate: { type: Date },
    lastDeclarationDate: { type: Date },
    monthlyDeductions: [MonthlyTaxDeductionSchema],

    // For negative adjustments
    noFurtherTaxDeduction: { type: Boolean, default: false },
    excessTaxPaid: { type: Number, default: 0 },

    poiSubmissionStatus: {
        type: String,
        enum: ["not_submitted", "submitted", "verified", "rejected", "resubmission"],
        default: "not_submitted"
    },
    reviewHistory: [
        {
            reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
            reviewDate: { type: Date },
            action: { type: String, enum: ["verified", "rejected", "resubmission_requested"] },
            comments: { type: String },
        },
    ],
    isLocked: { type: Boolean, default: false },
    initialTaxBreakdown: {
        taxAmount: { type: Number, default: 0 }, // SBT
        slabwiseTax: [
            {
                slab: { type: String },
                amount: { type: Number },
                fromAmount: { type: Number },
                toAmount: { type: Number, default: null, require: false }
            }
        ],
        cessAmount: { type: Number, default: 0 },
        totalTaxAmount: { type: Number, default: 0 },
        taxableIncome: { type: Number, default: 0 },
        rebateAmount: { type: Number, default: 0 }, // Added for Rebate 87A(a)
        isRebateApplicable: { type: Boolean, default: false }, // Flag for rebate eligibility
        marginalReliefAmount: { type: Number, default: 0 }, // Added for Marginal Relief 87A(b)
        isMarginalReliefApplicable: { type: Boolean, default: false }, // Flag for marginal relief eligibility
        taxWithCess: { type: Number, default: 0 }, // Tax before Form12B TDS deduction
        form12bTDSAmount: { type: Number, default: 0 }, // TDS amount from Form 12B, if applicable
        finalTaxWithCess: { type: Number, default: 0 } // Final tax after rebate/relief , cess and Form 12B TDS
    },
    isDeclared: { type: Boolean, default: false },
    isPOISubmitted: { type: Boolean, default: false },
    isResubmitted: { type: Boolean, default: false },
    form12B: { type: Schema.Types.ObjectId, ref: 'Form12B' }, // Reference to Form 12B
    salaryAssignments: [{
        assignmentId: { type: Schema.Types.ObjectId, ref: 'SalaryAssignment' },
        validFrom: { type: Date, required: true },
        validTill: { type: Date, required: true },
        monthlyGross: { type: Number, required: true },
        isActive: { type: Boolean, default: false }
    }],
    isForm12BApplicable: { type: Boolean, default: false }

},
    {
        timestamps: true
    })

// Add indexes for efficient queries
TaxDeclarationSchema.index({ employeeId: 1, financialYear: 1 }, { unique: true });
TaxDeclarationSchema.index({ financialYear: 1 });


export const TaxDeclaration = model<ITaxDeclaration>('TaxDeclaration', TaxDeclarationSchema)



/*
// Pre-save middleware to ensure consistency
TaxDeclarationSchema.pre('save', function (next) {
    // Update isResubmitted based on declarations
    this.isResubmitted = this.declarations.some(decl => decl.resubmissionInfo.isResubmitted);

    // Calculate totalDeclinedAmount (declarations that were rejected)
    this.totalDeclinedAmount = this.declarations
        .filter(decl => decl.status === 'rejected')
        .reduce((sum, decl) => sum + decl.declaredAmount, 0);

    // Update remainingTaxToPay field
    this.remainingTaxToPay = this.revisedTaxAmount - this.taxPaid;

    // If refund eligible, set appropriate flags
    if (this.remainingTaxToPay < 0) {
        this.excessTaxPaid = Math.abs(this.remainingTaxToPay);
        // this.refundEligible = true;
    }

    next();
});
*/