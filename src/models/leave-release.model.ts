import { Schema, model, Document, Types } from 'mongoose';

export interface ILeaveRelease extends Document {
  employeeId: Types.ObjectId;
  releaseType: 'monthly' | 'quarterly'; // monthly = 1 month, quarterly = 3 months
  period: {
    month?: number;      // 1-12 (required for monthly)
    quarter?: number;    // 1-4 (required for quarterly, Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
    year: number;
  };
  leaveType: 'annual' | 'sick' | 'compOff' | 'lossOfPay' | 'otherPaid' | 'otherUnpaid';
  daysReleased: number;  // Can be decimal (e.g., 4.5)
  releasedAt: Date;
  releasedBy: Types.ObjectId;  // Admin user
  notes?: string;
}

const leaveReleaseSchema = new Schema<ILeaveRelease>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    releaseType: {
      type: String,
      enum: ['monthly', 'quarterly'],
      required: true
    },
    period: {
      month: {
        type: Number,
        min: 1,
        max: 12,
        required: function(this: ILeaveRelease) {
          return this.releaseType === 'monthly';
        }
      },
      quarter: {
        type: Number,
        min: 1,
        max: 4,
        required: function(this: ILeaveRelease) {
          return this.releaseType === 'quarterly';
        }
      },
      year: { type: Number, required: true }
    },
    leaveType: {
      type: String,
      enum: ['annual', 'sick', 'compOff', 'lossOfPay', 'otherPaid', 'otherUnpaid'],
      required: true
    },
    daysReleased: {
      type: Number,
      required: true,
      min: 0
    },
    releasedAt: {
      type: Date,
      default: Date.now
    },
    releasedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    notes: String
  },
  {
    timestamps: true
  }
);

// Indexes for efficient queries
leaveReleaseSchema.index({ employeeId: 1, 'period.year': -1 });
leaveReleaseSchema.index({ releaseType: 1, 'period.year': 1 });

// Validate period based on release type
leaveReleaseSchema.pre('save', function (next) {
  if (this.releaseType === 'monthly' && !this.period.month) {
    return next(new Error('Month is required for monthly release'));
  }
  if (this.releaseType === 'quarterly' && !this.period.quarter) {
    return next(new Error('Quarter is required for quarterly release'));
  }
  if (this.releaseType === 'monthly' && this.period.quarter) {
    return next(new Error('Quarter should not be set for monthly release'));
  }
  if (this.releaseType === 'quarterly' && this.period.month) {
    return next(new Error('Month should not be set for quarterly release'));
  }
  next();
});

export const LeaveRelease = model<ILeaveRelease>('LeaveRelease', leaveReleaseSchema);

