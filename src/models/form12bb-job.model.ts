import { Document, Schema, Types, model } from 'mongoose';

export interface IForm12BBJob extends Document {
    financialYear: string;
    requestedBy: Types.ObjectId;
    selectionMode: 'explicit' | 'allMatching';
    employeeIds: Types.ObjectId[];
    filters?: {
        departmentId?: string;
        activeStatus?: boolean;
        search?: string;
        reportStatus?: 'generated' | 'notGenerated' | 'failed';
    };
    excludedEmployeeIds: Types.ObjectId[];
    status: 'Queued' | 'Processing' | 'Completed' | 'CompletedWithErrors' | 'Failed';
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    failures: Array<{ employeeId: Types.ObjectId; employeeName?: string; error: string }>;
    startedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const form12BBJobSchema = new Schema<IForm12BBJob>({
    financialYear: { type: String, required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    selectionMode: { type: String, enum: ['explicit', 'allMatching'], required: true },
    employeeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    filters: {
        departmentId: String,
        activeStatus: Boolean,
        search: String,
        reportStatus: { type: String, enum: ['generated', 'notGenerated', 'failed'] },
    },
    excludedEmployeeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: {
        type: String,
        enum: ['Queued', 'Processing', 'Completed', 'CompletedWithErrors', 'Failed'],
        default: 'Queued',
        index: true,
    },
    total: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    failures: [{
        employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        employeeName: String,
        error: { type: String, required: true },
        _id: false,
    }],
    startedAt: Date,
    completedAt: Date,
}, { timestamps: true });

form12BBJobSchema.index({ requestedBy: 1, createdAt: -1 });

export const Form12BBJob = model<IForm12BBJob>('Form12BBJob', form12BBJobSchema);
