import { model, Schema, Types } from 'mongoose';

export interface IConsolidatedTaxArtifact {
    _id: string; // Financial year is the primary key: exactly one current report per FY.
    fileId?: Types.ObjectId;
    fileName?: string;
    revision: number;
    generatedAt?: Date;
    generatedBy?: Types.ObjectId;
    generatedByName?: string;
    employeeCount?: number;
    reviewCount?: number;
    unapprovedEmployeeCount?: number;
    generationToken?: string;
    generationExpiresAt?: Date;
}
const schema = new Schema<IConsolidatedTaxArtifact>({
    _id: { type: String, required: true },
    fileId: Schema.Types.ObjectId,
    fileName: String,
    revision: { type: Number, default: 0 },
    generatedAt: Date,
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    generatedByName: String,
    employeeCount: Number,
    reviewCount: Number,
    unapprovedEmployeeCount: Number,
    generationToken: String,
    generationExpiresAt: Date,
}, { timestamps: true, collection: 'consolidated_tax_reports' });

export const ConsolidatedTaxArtifact = model<IConsolidatedTaxArtifact>('ConsolidatedTaxArtifact', schema);
