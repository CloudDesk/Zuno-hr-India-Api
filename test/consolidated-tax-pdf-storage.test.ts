import { Readable } from 'stream';
const mockMetadata = jest.fn();
const mockStream = jest.fn();
const mockFile = jest.fn(() => ({ getMetadata: mockMetadata, createReadStream: mockStream }));
const mockBucket = jest.fn(() => ({ file: mockFile }));
jest.mock('@google-cloud/storage', () => ({ Storage: jest.fn(() => ({ bucket: mockBucket })) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
process.env.GCP_STORAGE_BUCKET = 'test-private-bucket';
const { readPrivateFileFromGCP } = require('../src/utilis/gcpStorage');
beforeEach(() => { jest.clearAllMocks(); mockMetadata.mockResolvedValue([{}]); });
it('uses server storage reads for an encoded object in the configured bucket', async () => {
 const stream = Readable.from(['%PDF-']); mockStream.mockReturnValueOnce(stream);
 expect(await readPrivateFileFromGCP('https://storage.googleapis.com/test-private-bucket/reports/a%20b.pdf')).toBe(stream);
 expect(mockBucket).toHaveBeenCalledWith('test-private-bucket'); expect(mockFile).toHaveBeenCalledWith('reports/a b.pdf');
});
it.each(['https://evil.test/file', 'https://storage.googleapis.com/another-bucket/file'])('rejects outside storage URL %s', async url => {
 await expect(readPrivateFileFromGCP(url)).rejects.toThrow('Unsupported storage URL'); expect(mockFile).not.toHaveBeenCalled();
});
it('propagates read permission errors before creating a stream', async () => {
 mockMetadata.mockRejectedValueOnce(new Error('Access denied'));
 await expect(readPrivateFileFromGCP('https://storage.googleapis.com/test-private-bucket/report.pdf')).rejects.toThrow('Access denied');
 expect(mockStream).not.toHaveBeenCalled();
});
