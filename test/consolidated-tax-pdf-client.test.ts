import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const source = fs.readFileSync(path.resolve(__dirname,'../../Zuno-hr-India/src/lib/services/api/consolidatedTaxPdf.ts'),'utf8');
const fetchApi=jest.fn();
const fetchApiBlob=jest.fn();
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject:any={};
vm.runInNewContext(output,{exports:exportsObject,require:(name:string)=>{if(name!=='./base')throw new Error('Unexpected dependency');return {fetchApi,fetchApiBlob};},URLSearchParams});
const api=exportsObject.consolidatedTaxPdfApi;
it.each(['status','preview','download'])('passes testing date to %s availability checks',async action=>{
 await api[action]('2026-2027','2027-04-01');expect(fetchApi).toHaveBeenCalledWith(`/consolidated-tax-pdf/${action}?financialYear=2026-2027&testDate=2027-04-01`);
});
it('passes testing date with generation without replacing the financial year',async()=>{
 await api.generate('2026-2027','2027-04-01',1);expect(fetchApi).toHaveBeenCalledWith('/consolidated-tax-pdf/generate',{method:'POST',body:JSON.stringify({financialYear:'2026-2027',testDate:'2027-04-01',part:1})});
});
beforeEach(()=>{fetchApi.mockReset().mockResolvedValue({data:{exists:true}});fetchApiBlob.mockReset();});
it.each(['status','preview','download'])('requests the PDF-only %s endpoint',async action=>{
 await api[action]('2026-2027');expect(fetchApi).toHaveBeenCalledWith(`/consolidated-tax-pdf/${action}?financialYear=2026-2027`);
});
it('generates one selected part using the actual date',async()=>{
 await api.generate('2026-2027',undefined,1);expect(fetchApi).toHaveBeenCalledWith('/consolidated-tax-pdf/generate',{method:'POST',body:JSON.stringify({financialYear:'2026-2027',part:1})});
});
it('encodes financial-year query parameters without adding extra parameters',async()=>{
 await api.status('2026-2027&role=admin');const url=fetchApi.mock.calls[0][0];const parameters=new URL(url,'https://example.test').searchParams;
 expect([...parameters.keys()]).toEqual(['financialYear']);expect(parameters.get('financialYear')).toBe('2026-2027&role=admin');
});
it('propagates backend errors so the PDF UI can display them',async()=>{
 fetchApi.mockRejectedValueOnce(new Error('Upload failed'));await expect(api.generate('2026-2027',undefined,1)).rejects.toThrow('Upload failed');
});

it.each(['preview','download'])('requests selected part for %s',async action=>{
 await api[action]('2026-2027','2027-04-01',2);expect(fetchApi).toHaveBeenCalledWith(`/consolidated-tax-pdf/${action}?financialYear=2026-2027&testDate=2027-04-01&part=2`);
});

it('generates only the selected PDF part',async()=>{
 await api.generate('2026-2027','2027-04-01',2);expect(fetchApi).toHaveBeenCalledWith('/consolidated-tax-pdf/generate',{method:'POST',body:JSON.stringify({financialYear:'2026-2027',testDate:'2027-04-01',part:2})});
});

it('downloads bytes through the authenticated API with year, date and part', async()=>{
 const blob=new Blob(['%PDF-1.7']);fetchApiBlob.mockResolvedValueOnce(blob);
 expect(await api.downloadFile('2026-2027','2027-04-01',2)).toBe(blob);
 expect(fetchApiBlob).toHaveBeenCalledWith('/consolidated-tax-pdf/file?financialYear=2026-2027&testDate=2027-04-01&part=2');
 expect(fetchApi).not.toHaveBeenCalled();
});

it('downloads using the actual date when no testing date is selected', async()=>{
 await api.downloadFile('2026-2027',undefined,1);
 expect(fetchApiBlob).toHaveBeenCalledWith('/consolidated-tax-pdf/file?financialYear=2026-2027&part=1');
});

it('propagates authenticated download failures to the UI', async()=>{
 fetchApiBlob.mockRejectedValueOnce(new Error('Unauthorized access'));
 await expect(api.downloadFile('2026-2027',undefined,1)).rejects.toThrow('Unauthorized access');
});
