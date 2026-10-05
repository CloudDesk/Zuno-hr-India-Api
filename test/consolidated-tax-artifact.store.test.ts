import { ConsolidatedTaxArtifact } from '../src/models/consolidated-tax-artifact.model';
import { consolidatedTaxArtifactStore as store } from '../src/services/consolidated-tax-artifact.store';

jest.mock('../src/models/consolidated-tax-artifact.model', () => ({ ConsolidatedTaxArtifact: {
    findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findById: jest.fn(),
} }));
it('acquires only an absent or expired lease under the financial-year primary key', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    jest.mocked(ConsolidatedTaxArtifact.findOneAndUpdate).mockReturnValue({ lean: async () => ({ _id: '2025-2026', revision: 0 }) } as any);
    await store.acquire('2025-2026', 'owner', now);
    expect(ConsolidatedTaxArtifact.findOneAndUpdate).toHaveBeenCalledWith({
        _id: '2025-2026', $or: [{ generationExpiresAt: { $exists: false } }, { generationExpiresAt: { $lte: now } }],
    }, { $set: { generationToken: 'owner', generationExpiresAt: new Date('2026-01-01T00:10:00Z') } },
    { upsert: true, new: true, setDefaultsOnInsert: true });
});
it('treats the duplicate FY key as another admin owning the lease', async () => {
    jest.mocked(ConsolidatedTaxArtifact.findOneAndUpdate).mockReturnValue({ lean: async () => { throw { code: 11000 }; } } as any);
    expect(await store.acquire('2025-2026', 'owner', new Date())).toBeNull();
});
it('does not hide other database failures as concurrency conflicts', async () => {
    jest.mocked(ConsolidatedTaxArtifact.findOneAndUpdate).mockReturnValue({ lean: async () => { throw new Error('Database unavailable'); } } as any);
    await expect(store.acquire('2025-2026', 'owner', new Date())).rejects.toThrow('Database unavailable');
});
it('requires the owner token to publish and release, protecting a newer generation', async () => {
    jest.mocked(ConsolidatedTaxArtifact.findOneAndUpdate).mockReturnValue({ lean: async () => null } as any);
    await store.commit('2025-2026', 'old-owner', { fileName: 'report.xlsx' });
    expect(ConsolidatedTaxArtifact.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '2025-2026', generationToken: 'old-owner' },
        { $set: { fileName: 'report.xlsx' }, $inc: { revision: 1 }, $unset: { generationToken: 1, generationExpiresAt: 1 } }, { new: true });
    await store.release('2025-2026', 'old-owner');
    expect(ConsolidatedTaxArtifact.updateOne).toHaveBeenCalledWith({ _id: '2025-2026', generationToken: 'old-owner' },
        { $unset: { generationToken: 1, generationExpiresAt: 1 } });
});
