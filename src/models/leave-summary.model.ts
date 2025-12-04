import { Schema, model, Document, Types } from 'mongoose';

interface ILeaveCategoryDetail {
  alloted: number;
  availed: number;
  remaining: number;
  leaveRequests: Types.ObjectId[];
  // UAE-specific fields for leave expiry tracking
  allocationDate?: Date;      // Date when leave was allocated
  expiryDate?: Date;           // Date when leave expires (auto: allocation + 1 year for UAE)
  originalExpiryDate?: Date;   // Original expiry before manual changes (for audit trail)
  manuallyAdjusted?: boolean;  // Flag indicating if expiry was manually changed
}

export interface ILeaveSummary extends Document {
  userId: Types.ObjectId;
  year: number;
  annual: ILeaveCategoryDetail;
  sick: ILeaveCategoryDetail;
  compOff: ILeaveCategoryDetail;
  lossOfPay: ILeaveCategoryDetail;
  otherPaid: ILeaveCategoryDetail;
  otherUnpaid: ILeaveCategoryDetail;
  maternity: ILeaveCategoryDetail;  // NEW: UAE-specific maternity leave
  workFromHome: ILeaveCategoryDetail;  // NEW: Work From Home (merged from WFHSummary)
  createdAt: Date;
  updatedAt: Date;
}

const leaveCategoryDetailSchema = new Schema<ILeaveCategoryDetail>({
  alloted: { type: Number, default: 0 },
  availed: { type: Number, default: 0 },
  remaining: { type: Number, default: 0 },
  leaveRequests: [{ type: Schema.Types.ObjectId, ref: 'Leave' }],
  // UAE-specific fields for leave expiry tracking
  allocationDate: { type: Date, required: false },
  expiryDate: { type: Date, required: false },
  originalExpiryDate: { type: Date, required: false },
  manuallyAdjusted: { type: Boolean, default: false }
});

const leaveSummarySchema = new Schema<ILeaveSummary>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    annual: leaveCategoryDetailSchema,
    sick: leaveCategoryDetailSchema,
    compOff: leaveCategoryDetailSchema,
    lossOfPay: leaveCategoryDetailSchema,
    otherPaid: leaveCategoryDetailSchema,
    otherUnpaid: leaveCategoryDetailSchema,
    maternity: leaveCategoryDetailSchema,  // NEW: UAE-specific maternity leave
    workFromHome: leaveCategoryDetailSchema  // NEW: Work From Home (merged from WFHSummary)
  },
  {
    timestamps: true
  }
);

// Create compound index for userId and year to ensure unique combination
leaveSummarySchema.index({ userId: 1, year: 1 }, { unique: true });

// Pre-save hook to calculate remaining days
leaveSummarySchema.pre('save', function (this: ILeaveSummary & Document, next) {
  // Calculate remaining days for each leave category
  const categories = ['annual', 'sick', 'compOff', 'lossOfPay', 'otherPaid', 'otherUnpaid', 'maternity', 'workFromHome'] as const;

  categories.forEach(category => {
    const leaveCategory = this[category];
    if (leaveCategory) {
      leaveCategory.remaining = Math.max(0, leaveCategory.alloted - leaveCategory.availed);
    }
  });

  next();
});

// Pre-save hook for UAE leave expiry date logic
leaveSummarySchema.pre('save', async function (this: ILeaveSummary & Document, next) {
  try {
    // Get user to check if location is UAE
    const User = model('User');
    const user = await User.findById(this.userId).select('country');

    if (!user) {
      return next();
    }

    const categories = ['annual', 'sick', 'compOff', 'lossOfPay', 'otherPaid', 'otherUnpaid', 'maternity', 'workFromHome'] as const;

    // Only apply expiry logic for UAE users
    if (user.country === 'AE') {
      categories.forEach(category => {
        const leaveCategory = this[category];

        if (leaveCategory) {
          // SCENARIO 1: New allocation date set or changed
          // Auto-calculate expiry = allocation + 1 year
          if (this.isModified(`${category}.allocationDate`) && leaveCategory.allocationDate) {
            const expiryDate = new Date(leaveCategory.allocationDate);
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            leaveCategory.expiryDate = expiryDate;
            leaveCategory.originalExpiryDate = expiryDate;
            leaveCategory.manuallyAdjusted = false;

            console.log(`✅ [UAE Leave Expiry] ${category} - Allocation: ${leaveCategory.allocationDate.toISOString()}, Auto Expiry: ${expiryDate.toISOString()}`);
          }

          // SCENARIO 2: Expiry date manually changed by admin
          // Track the manual change and preserve original date for audit
          if (this.isModified(`${category}.expiryDate`) &&
            leaveCategory.expiryDate &&
            leaveCategory.originalExpiryDate &&
            leaveCategory.expiryDate.getTime() !== leaveCategory.originalExpiryDate.getTime()) {

            leaveCategory.manuallyAdjusted = true;

            console.log(`⚠️ [UAE Leave Expiry] ${category} - Expiry manually changed from ${leaveCategory.originalExpiryDate.toISOString()} to ${leaveCategory.expiryDate.toISOString()}`);
            console.log(`📝 [UAE Leave Expiry] ${category} - Manual adjustment recorded. Original allocation: ${leaveCategory.allocationDate?.toISOString() || 'N/A'}`);
          }

          // SCENARIO 3: If expiry date set but no allocation date
          // Calculate allocation date backwards (expiry - 1 year)
          if (leaveCategory.expiryDate && !leaveCategory.allocationDate) {
            const calculatedAllocationDate = new Date(leaveCategory.expiryDate);
            calculatedAllocationDate.setFullYear(calculatedAllocationDate.getFullYear() - 1);
            leaveCategory.allocationDate = calculatedAllocationDate;
            leaveCategory.originalExpiryDate = leaveCategory.expiryDate;

            console.log(`🔄 [UAE Leave Expiry] ${category} - Calculated allocation date from expiry: ${calculatedAllocationDate.toISOString()}`);
          }
        }
      });
    }

    next();
  } catch (error: any) {
    console.error('❌ [UAE Leave Expiry] Error in pre-save hook:', error);
    next(error);
  }
});

export const LeaveSummary = model<ILeaveSummary>('LeaveSummary', leaveSummarySchema); 