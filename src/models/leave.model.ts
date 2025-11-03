import { Schema, model, Document, Types } from 'mongoose';

export interface ILeave extends Document {
  userId: string | Types.ObjectId;
  user?: {
    name: string;
    email: string;
  };
  leaveTypeId: Types.ObjectId;
  leaveType: string;
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
}

const leaveSchema = new Schema<ILeave>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    user: {
      name: String,
      email: String,
      _id: false,
    },
    leaveTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'Lov' },
    leaveType: String,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
      required: true,
      default: 'Pending',
    },
    remarks: String,
    reason: String,
    appliedTo: {
      _id: String,
      name: String,
    },
    noOfDays: Number,
    approvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: {
      _id: { type: Schema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,

    },
    approvedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
leaveSchema.index({ userId: 1, startDate: -1 });
leaveSchema.index({ status: 1 });
leaveSchema.index({ approvedById: 1 });

// Validate end date is after start date
leaveSchema.pre('save', function (next) {
  if (this.endDate < this.startDate) {
    next(new Error('End date must be after start date'));
  }
  next();
});

export const Leave = model<ILeave>('Leave', leaveSchema); 