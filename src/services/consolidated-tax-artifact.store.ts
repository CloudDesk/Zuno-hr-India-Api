import mongoose from 'mongoose';
import { ConsolidatedTaxArtifact, IConsolidatedTaxArtifact } from '../models/consolidated-tax-artifact.model';

/** Dedicated private GridFS files: not exposed through public uploads or static routes. */
function bucket() {
    if (!mongoose.connection.db) throw new Error('Database is not connected.');
    return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'consolidatedTaxReportFiles' });
}
export const consolidatedTaxArtifactStore = {
    get: (financialYear: string) => ConsolidatedTaxArtifact.findById(financialYear).lean(),
    async acquire(financialYear: string, token: string, now: Date): Promise<IConsolidatedTaxArtifact | null> {
        try {
            return await ConsolidatedTaxArtifact.findOneAndUpdate({
                _id: financialYear,
                $or: [{ generationExpiresAt: { $exists: false } }, { generationExpiresAt: { $lte: now } }],
            }, { $set: { generationToken: token, generationExpiresAt: new Date(now.getTime() + 10 * 60 * 1000) } },
            { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
        } catch (error) {
            // A concurrent request already owns the FY primary key/lease.
            if ((error as { code?: number }).code === 11000) return null;
            throw error;
        }
    },
    async upload(financialYear: string, fileName: string, data: Buffer): Promise<string> {
        const upload = bucket().openUploadStream(fileName, { metadata: { financialYear }, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        try {
            await new Promise<void>((resolve, reject) => {
                upload.once('finish', resolve);
                upload.once('error', reject);
                upload.end(data);
            });
            return String(upload.id);
        } catch (error) {
            await upload.abort().catch(() => undefined);
            throw error;
        }
    },
    commit: (financialYear: string, token: string, data: Partial<IConsolidatedTaxArtifact>) =>
        ConsolidatedTaxArtifact.findOneAndUpdate({ _id: financialYear, generationToken: token },
            { $set: data, $inc: { revision: 1 }, $unset: { generationToken: 1, generationExpiresAt: 1 } }, { new: true }).lean(),
    async release(financialYear: string, token: string): Promise<void> {
        await ConsolidatedTaxArtifact.updateOne({ _id: financialYear, generationToken: token }, { $unset: { generationToken: 1, generationExpiresAt: 1 } });
    },
    async remove(fileId: string): Promise<void> { await bucket().delete(new mongoose.mongo.ObjectId(fileId)); },
    async download(fileId: string): Promise<Buffer> {
        const stream = bucket().openDownloadStream(new mongoose.mongo.ObjectId(fileId));
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    },
};
