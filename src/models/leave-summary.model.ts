import { Schema, model, Document, Types } from 'mongoose';

interface ILeaveCategoryDetail {
  alloted: number;
  availed: number;
  remaining: number;
  leaveRequests: Types.ObjectId[];
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
  maternity: ILeaveCategoryDetail;
  workFromHome: ILeaveCategoryDetail;
  createdAt: Date;
  updatedAt: Date;
}

const leaveCategoryDetailSchema = new Schema<ILeaveCategoryDetail>({
  alloted: { type: Number, default: 0 },
  availed: { type: Number, default: 0 },
  remaining: { type: Number, default: 0 },
  leaveRequests: [{ type: Schema.Types.ObjectId, ref: 'Leave' }]
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
    maternity: leaveCategoryDetailSchema,
    workFromHome: leaveCategoryDetailSchema
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


export const LeaveSummary = model<ILeaveSummary>('LeaveSummary', leaveSummarySchema); 