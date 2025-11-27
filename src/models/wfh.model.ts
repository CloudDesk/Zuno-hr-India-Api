import { Schema, model, Document, Types } from 'mongoose';

export interface IWFH extends Document {
  userId: string | Types.ObjectId;
  user?: {
    name: string;
    email: string;
  };
  startDate: Date;
  endDate: Date;
  noOfDays: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  remarks?: string;
  reason: string;
  appliedTo?: {
    _id: string;
    name: string;
  };
  approvedById?: Types.ObjectId;
  approvedBy?: {
    _id: string;
    name: string;
    email: string;
  };
  approvedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
}

const wfhSchema = new Schema<IWFH>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    user: {
      name: String,
      email: String,
      _id: false,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    noOfDays: { type: Number, required: true, min: 0.5 },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      required: true,
      default: 'Pending',
    },
    remarks: String,
    reason: { type: String, required: true },
    appliedTo: {
      _id: String,
      name: String,
    },
    approvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: {
      _id: { type: Schema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,
    },
    approvedAt: Date,
    rejectedAt: Date,
    cancelledAt: Date,
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
wfhSchema.index({ userId: 1, startDate: -1 });
wfhSchema.index({ status: 1 });
wfhSchema.index({ approvedById: 1 });

// Validate end date is after start date
wfhSchema.pre('save', function (next) {
  if (this.endDate < this.startDate) {
    next(new Error('End date must be after start date'));
  }
  next();
});

export const WFH = model<IWFH>('WFH', wfhSchema);

