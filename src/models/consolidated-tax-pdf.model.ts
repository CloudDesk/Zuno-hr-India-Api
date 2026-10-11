import { model, Schema } from 'mongoose';
export interface ConsolidatedTaxPdfPart {
    part: number; fileUrl: string; fileName: string; employeeCount: number; firstEmployee: number; lastEmployee: number; reviewCount?: number;
}
export interface IConsolidatedTaxPdf {
    _id: string; fileUrl?: string; fileName?: string; generatedAt?: Date; generatedByName?: string;
    employeeCount?: number; reviewCount?: number; revision: number; generationToken?: string; generationExpiresAt?: Date;
    parts?: ConsolidatedTaxPdfPart[]; employeeIds?: string[];
}
const schema = new Schema<IConsolidatedTaxPdf>({
    _id: { type: String, required: true }, fileUrl: String, fileName: String, generatedAt: Date,
    generatedByName: String, employeeCount: Number, reviewCount: Number, revision: { type: Number, default: 0 },
    generationToken: String, generationExpiresAt: Date,
    employeeIds: { type: [String], default: undefined },
    parts: { type: [new Schema<ConsolidatedTaxPdfPart>({
        part: { type: Number, required: true }, fileUrl: { type: String, required: true }, fileName: { type: String, required: true },
        employeeCount: { type: Number, required: true }, firstEmployee: { type: Number, required: true }, lastEmployee: { type: Number, required: true }, reviewCount: Number,
    }, { _id: false })], default: undefined },
}, { timestamps: true, collection: 'consolidated_tax_pdfs' });
export const ConsolidatedTaxPdf = model<IConsolidatedTaxPdf>('ConsolidatedTaxPdf', schema);
