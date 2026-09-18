import { Document, Schema, model } from 'mongoose';

export interface IPOIGenerationLock extends Document {
    key: string;
    ownerToken: string;
    expiresAt: Date;
}

const poiGenerationLockSchema = new Schema<IPOIGenerationLock>({
    key: { type: String, required: true, unique: true },
    ownerToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

poiGenerationLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const POIGenerationLock = model<IPOIGenerationLock>('POIGenerationLock', poiGenerationLockSchema);
