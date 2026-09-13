import { Schema, model, Document, Types } from 'mongoose';

export interface ISocialEvent extends Document {
    type: 'Birthday' | 'Anniversary' | 'Event' | 'Greeting' | 'Policy' | 'Other';
    employeeId?: Types.ObjectId; // Optional: specific to one employee (milestones)
    subject: string;
    message: string;
    eventDate: Date; // For sorting and persistence logic
    active: boolean; // Inactive communications remain in admin history but are hidden from users
    attachments?: string[]; // Array of file paths/URLs
    expiryDate?: Date; // Optional: when the post should disappear
    postedBy: Types.ObjectId | 'SYSTEM';
    metadata?: {
        years?: number; // For anniversaries
        category?: string;
        link?: string;
    };
    targets?: {
        roles?: string[];
        departments?: string[];
        employees?: Types.ObjectId[];
    };
    assignmentHistory?: Array<{
        employeeId: Types.ObjectId;
        employeeName?: string;
        employeeCode?: string;
        employeeEmail?: string;
        assignedAt: Date;
        assignedBy: Types.ObjectId;
        assignedByName?: string;
    }>;
    createdAt: Date;
    updatedAt: Date;
}

const socialEventSchema = new Schema<ISocialEvent>(
    {
        type: {
            type: String,
            enum: ['Birthday', 'Anniversary', 'Event', 'Greeting', 'Policy', 'Other'],
            required: true,
        },
        employeeId: { type: Schema.Types.ObjectId, ref: 'User' },
        subject: { type: String, required: true },
        message: { type: String, required: true },
        eventDate: { type: Date, required: true },
        active: { type: Boolean, default: true, index: true },
        attachments: [{ type: String }],
        expiryDate: { type: Date },
        postedBy: { type: Schema.Types.Mixed, required: true },
        metadata: { type: Schema.Types.Mixed },
        targets: {
            roles: [{ type: String }],
            departments: [{ type: String }],
            employees: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        },
        assignmentHistory: [{
            employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            employeeName: { type: String },
            employeeCode: { type: String },
            employeeEmail: { type: String },
            assignedAt: { type: Date, default: Date.now, required: true },
            assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            assignedByName: { type: String },
            _id: false
        }],
    },
    { timestamps: true }
);

// Indexes
socialEventSchema.index({ eventDate: -1 });
socialEventSchema.index({ type: 1, eventDate: 1 });
socialEventSchema.index({ employeeId: 1 });

export const SocialEvent = model<ISocialEvent>('SocialEvent', socialEventSchema);
