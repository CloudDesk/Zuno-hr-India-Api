import { Schema, model, Document, Types } from 'mongoose';

export type LeaveReleaseFrequency = 'monthly' | 'quarterly' | 'yearly';
export type LeaveReleaseConfigurationStatus = 'active' | 'paused' | 'inactive';

export interface ILeaveReleaseConfiguration extends Document {
  name: string;
  leaveType: string;
  frequency: LeaveReleaseFrequency;
  daysPerRelease: number;
  effectiveStartDate: Date;
  effectiveEndDate?: Date;
  employeeIds: Types.ObjectId[];
  status: LeaveReleaseConfigurationStatus;
  nextRunAt: Date;
  lastRunAt?: Date;
  lastRunStatus?: 'success' | 'partial' | 'failed';
  lastRunMessage?: string;
  processingAt?: Date;
  processingToken?: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const leaveReleaseConfigurationSchema = new Schema<ILeaveReleaseConfiguration>(
  {
    name: { type: String, required: true, trim: true },
    leaveType: { type: String, required: true, trim: true },
    frequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      required: true
    },
    daysPerRelease: { type: Number, required: true, min: 0.5 },
    effectiveStartDate: { type: Date, required: true },
    effectiveEndDate: { type: Date },
    employeeIds: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    status: {
      type: String,
      enum: ['active', 'paused', 'inactive'],
      default: 'active',
      required: true
    },
    nextRunAt: { type: Date, required: true },
    lastRunAt: { type: Date },
    lastRunStatus: { type: String, enum: ['success', 'partial', 'failed'] },
    lastRunMessage: { type: String },
    processingAt: { type: Date },
    processingToken: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

leaveReleaseConfigurationSchema.index({ status: 1, nextRunAt: 1 });
leaveReleaseConfigurationSchema.index({ leaveType: 1, status: 1 });

export const LeaveReleaseConfiguration = model<ILeaveReleaseConfiguration>(
  'LeaveReleaseConfiguration',
  leaveReleaseConfigurationSchema
);
