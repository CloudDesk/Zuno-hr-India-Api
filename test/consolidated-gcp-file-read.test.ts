const mockDownload=jest.fn();
const mockFile=jest.fn(()=>({download:mockDownload}));
const mockBucket=jest.fn(()=>({file:mockFile}));
jest.mock('@google-cloud/storage',()=>({Storage:jest.fn(()=>({bucket:mockBucket}))}));
jest.mock('dotenv',()=>({__esModule:true,default:{config:jest.fn()}}));
export {};
let originalBucket: string | undefined;
beforeAll(()=>{originalBucket=process.env.GCP_STORAGE_BUCKET;process.env.GCP_STORAGE_BUCKET='example-bucket';});
afterAll(()=>{if(originalBucket===undefined)delete process.env.GCP_STORAGE_BUCKET;else process.env.GCP_STORAGE_BUCKET=originalBucket;});
beforeEach(()=>{mockDownload.mockReset();mockFile.mockClear();mockBucket.mockClear();});
it('reads private PDF bytes using the configured storage client',async()=>{
 const {readFileFromGCP}=await import('../src/utilis/gcpStorage');const buffer=Buffer.from('%PDF-1.7 sample');mockDownload.mockResolvedValue([buffer]);
 expect(await readFileFromGCP('https://storage.googleapis.com/example-bucket/tax/report.pdf')).toBe(buffer);
 expect(mockBucket).toHaveBeenCalledWith('example-bucket');expect(mockFile).toHaveBeenCalledWith('tax/report.pdf');expect(mockDownload).toHaveBeenCalledTimes(1);
});
it.each(['https://example.test/report.pdf','https://storage.googleapis.com/another-bucket/report.pdf'])('rejects untrusted storage location %s',async url=>{
 const {readFileFromGCP}=await import('../src/utilis/gcpStorage');await expect(readFileFromGCP(url)).rejects.toThrow('Unsupported storage URL');expect(mockDownload).not.toHaveBeenCalled();
});
it('propagates storage permission failures for the authenticated route to handle',async()=>{
 const {readFileFromGCP}=await import('../src/utilis/gcpStorage');mockDownload.mockRejectedValue(new Error('Forbidden'));
 await expect(readFileFromGCP('https://storage.googleapis.com/example-bucket/report.pdf')).rejects.toThrow('Forbidden');
});
