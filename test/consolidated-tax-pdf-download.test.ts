import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const source=fs.readFileSync(path.resolve(__dirname,'../../Zuno-hr-India/src/lib/utils/downloadConsolidatedPdf.ts'),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function setup(contents='%PDF-1.7 sample',ok=true) {
 const link:any={click:jest.fn(),remove:jest.fn()};
 const fetch=jest.fn().mockResolvedValue({ok,blob:async()=>new Blob([contents])});
 const createObjectURL=jest.fn().mockReturnValue('blob:download');
 const revokeObjectURL=jest.fn();const setTimeout=jest.fn();
 const exports:any={};const appendChild=jest.fn();
 vm.runInNewContext(output,{exports,fetch,Blob,URL:{createObjectURL,revokeObjectURL},document:{createElement:()=>link,body:{appendChild}},setTimeout});
 return {download:exports.downloadConsolidatedPdf,link,fetch,createObjectURL,revokeObjectURL,setTimeout,appendChild};
}
it('downloads a PDF with the selected FY filename without opening a new tab',async()=>{
 const r=setup();await r.download(new Blob(['%PDF-1.7 sample']),'2026-2027');
 expect(r.link.download).toBe('Consolidated_Tax_Report_2026-2027.pdf');
 expect(r.link.href).toBe('blob:download');expect(r.link.target).toBeUndefined();
 expect(r.link.click).toHaveBeenCalledTimes(1);expect(r.link.remove).toHaveBeenCalledTimes(1);
 expect(r.createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
 expect(r.setTimeout.mock.calls[0][1]).toBe(60000);
 r.setTimeout.mock.calls[0][0]();expect(r.revokeObjectURL).toHaveBeenCalledWith('blob:download');
});
it.each(['<Error>AccessDenied</Error>','', '<html>Error</html>'])('does not save an error response as a PDF: %s',async contents=>{
 const r=setup(contents);await expect(r.download(new Blob([contents]),'2028-2029')).rejects.toThrow('as a PDF');
 expect(r.link.click).not.toHaveBeenCalled();expect(r.createObjectURL).not.toHaveBeenCalled();
});
it('saves the distinct PDF part filename',async()=>{
 const r=setup();await r.download(new Blob(['%PDF-1.7 sample']),'2026-2027','Consolidated_Tax_Report_2026-2027_Part_2.pdf');
 expect(r.link.download).toBe('Consolidated_Tax_Report_2026-2027_Part_2.pdf');
});
