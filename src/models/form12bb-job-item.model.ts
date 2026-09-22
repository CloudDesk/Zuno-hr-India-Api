import { Document, Schema, Types, model } from 'mongoose';

export type Form12BBJobItemStatus = 'Queued' | 'Processing' | 'Completed' | 'Failed';

export interface IForm12BBJobItem extends Document {
    activeKey?: string;
    jobId: Types.ObjectId;
    employeeId: Types.ObjectId;
    employeeName?: string;
    financialYear: string;
    status: Form12BBJobItemStatus;
    attempts: number;
    leaseOwner?: string;
    leaseExpiresAt?: Date;
    nextAttemptAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    lastError?: string;
    createdAt: Date;
    updatedAt: Date;
}

const form12BBJobItemSchema = new Schema<IForm12BBJobItem>({
    activeKey: { type: String },
    jobId: { type: Schema.Types.ObjectId, ref: 'Form12BBJob', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    employeeName: String,
    financialYear: { type: String, required: true },
    status: {
        type: String,
        enum: ['Queued', 'Processing', 'Completed', 'Failed'],
        default: 'Queued',
        index: true,
    },
    attempts: { type: Number, default: 0 },
    leaseOwner: String,
    leaseExpiresAt: Date,
    nextAttemptAt: Date,
    startedAt: Date,
    completedAt: Date,
    lastError: String,
}, { timestamps: true });

form12BBJobItemSchema.index({ jobId: 1, employeeId: 1 }, { unique: true });
form12BBJobItemSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
form12BBJobItemSchema.index({ jobId: 1, status: 1, nextAttemptAt: 1, leaseExpiresAt: 1 });

export const Form12BBJobItem = model<IForm12BBJobItem>('Form12BBJobItem', form12BBJobItemSchema);
