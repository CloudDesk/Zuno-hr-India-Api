import { model, Schema } from 'mongoose';
export interface IConsolidatedTaxPdf {
    _id: string; fileUrl?: string; fileName?: string; generatedAt?: Date; generatedByName?: string;
    employeeCount?: number; reviewCount?: number; revision: number; generationToken?: string; generationExpiresAt?: Date;
}
const schema = new Schema<IConsolidatedTaxPdf>({
    _id: { type: String, required: true }, fileUrl: String, fileName: String, generatedAt: Date,
    generatedByName: String, employeeCount: Number, reviewCount: Number, revision: { type: Number, default: 0 },
    generationToken: String, generationExpiresAt: Date,
}, { timestamps: true, collection: 'consolidated_tax_pdfs' });
export const ConsolidatedTaxPdf = model<IConsolidatedTaxPdf>('ConsolidatedTaxPdf', schema);
