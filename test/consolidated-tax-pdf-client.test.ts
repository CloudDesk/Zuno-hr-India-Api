import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const source = fs.readFileSync(path.resolve(__dirname,'../../Zuno-hr-India/src/lib/services/api/consolidatedTaxPdf.ts'),'utf8');
const fetchApi=jest.fn();
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject:any={};
vm.runInNewContext(output,{exports:exportsObject,require:(name:string)=>{if(name!=='./base')throw new Error('Unexpected dependency');return {fetchApi};},URLSearchParams});
const api=exportsObject.consolidatedTaxPdfApi;
it.each(['status','preview','download'])('passes testing date to %s availability checks',async action=>{
 await api[action]('2026-2027','2027-04-01');expect(fetchApi).toHaveBeenCalledWith(`/consolidated-tax-pdf/${action}?financialYear=2026-2027&testDate=2027-04-01`);
});
it('passes testing date with generation without replacing the financial year',async()=>{
 await api.generate('2026-2027','2027-04-01');expect(fetchApi).toHaveBeenCalledWith('/consolidated-tax-pdf/generate',{method:'POST',body:JSON.stringify({financialYear:'2026-2027',testDate:'2027-04-01'})});
});
beforeEach(()=>{fetchApi.mockReset().mockResolvedValue({data:{exists:true}});});
it.each(['status','preview','download'])('requests the PDF-only %s endpoint',async action=>{
 await api[action]('2026-2027');expect(fetchApi).toHaveBeenCalledWith(`/consolidated-tax-pdf/${action}?financialYear=2026-2027`);
});
it('generates the selected financial year as JSON',async()=>{
 await api.generate('2026-2027');expect(fetchApi).toHaveBeenCalledWith('/consolidated-tax-pdf/generate',{method:'POST',body:JSON.stringify({financialYear:'2026-2027'})});
});
it('encodes financial-year query parameters without adding extra parameters',async()=>{
 await api.status('2026-2027&role=admin');const url=fetchApi.mock.calls[0][0];const parameters=new URL(url,'https://example.test').searchParams;
 expect([...parameters.keys()]).toEqual(['financialYear']);expect(parameters.get('financialYear')).toBe('2026-2027&role=admin');
});
it('propagates backend errors so the PDF UI can display them',async()=>{
 fetchApi.mockRejectedValueOnce(new Error('Upload failed'));await expect(api.generate('2026-2027')).rejects.toThrow('Upload failed');
});
