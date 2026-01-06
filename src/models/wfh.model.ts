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
  // Apply on behalf feature
  appliedOnBehalf?: boolean; // true if applied by admin on behalf of employee
  appliedBy?: {
    _id: string | Types.ObjectId; // ID of person who applied (employee or admin)
    name: string;
    email: string;
  };
  // Dual approval for applied on behalf
  managerApproved?: boolean; // Manager approval status
  managerApprovedById?: Types.ObjectId; // Manager who approved
  managerApprovedAt?: Date; // Manager approval timestamp
  adminApproved?: boolean; // Admin approval status
  adminApprovedById?: Types.ObjectId; // Admin who approved
  adminApprovedAt?: Date; // Admin approval timestamp
  // Document attachments (optional, for apply on behalf)
  documents?: Array<{
    fileName: string;
    filePath: string;
    uploadDate: Date;
    uploadedBy?: Types.ObjectId;
  }>;
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
    reason: { type: String, required: false },
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
    // Apply on behalf feature
    appliedOnBehalf: {
      type: Boolean,
      default: false
    },
    appliedBy: {
      _id: { type: Schema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,
    },
    // Dual approval for applied on behalf
    managerApproved: {
      type: Boolean,
      default: false
    },
    managerApprovedById: { type: Schema.Types.ObjectId, ref: 'User' },
    managerApprovedAt: Date,
    adminApproved: {
      type: Boolean,
      default: false
    },
    adminApprovedById: { type: Schema.Types.ObjectId, ref: 'User' },
    adminApprovedAt: Date,
    // Document attachments (optional, for apply on behalf)
    documents: [{
      fileName: { type: String, required: true },
      filePath: { type: String, required: true },
      uploadDate: { type: Date, default: Date.now },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    }],
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

