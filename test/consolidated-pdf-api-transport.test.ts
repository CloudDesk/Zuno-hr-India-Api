import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const source=fs.readFileSync(path.resolve(__dirname,'../../Zuno-hr-India/src/lib/services/api/base.ts'),'utf8').replace(/import\.meta\.env/g,"({DEV:true,MODE:'development'})");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function setup(response:any){
 const exports:any={};const fetch=jest.fn().mockResolvedValue(response);const auth={token:'test-token',clearAuth:jest.fn()};const goto=jest.fn();
 const requireModule=(name:string)=>{
  if(name==='$app/environment')return {browser:false};if(name==='$app/navigation')return {goto};
  if(name==='$lib/stores/auth')return {auth};if(name==='$lib/stores/navigation')return {navigationContext:'admin'};
  if(name==='svelte/store')return {get:(store:any)=>store};throw new Error(`Unexpected module ${name}`);
 };
 vm.runInNewContext(output,{exports,require:requireModule,fetch,FormData,console});return {api:exports.fetchApi,fetch,auth,goto};
}
it('authenticates PDF byte requests and retains cookie credentials',async()=>{
 const blob=new Blob(['%PDF-1.7 sample']);const response={ok:true,status:200,blob:jest.fn().mockResolvedValue(blob),json:jest.fn()};const r=setup(response);
 expect(await r.api('/consolidated-tax-pdf/file',{},'blob')).toBe(blob);
 expect(r.fetch).toHaveBeenCalledWith('/api/consolidated-tax-pdf/file',{headers:{Authorization:'Bearer test-token'},credentials:'include'});expect(response.json).not.toHaveBeenCalled();
});
it('keeps JSON as the default for existing API calls',async()=>{
 const response={ok:true,status:200,json:jest.fn().mockResolvedValue({success:true}),blob:jest.fn()};const r=setup(response);
 expect(await r.api('/existing')).toEqual({success:true});expect(response.blob).not.toHaveBeenCalled();
});
it('reports JSON storage errors instead of downloading them as PDF',async()=>{
 const r=setup({ok:false,status:400,json:async()=>({success:false,message:'Check storage access'})});await expect(r.api('/file',{},'blob')).rejects.toThrow('Check storage access');
});
it('retains expired-session handling for PDF requests',async()=>{
 const r=setup({ok:false,status:401});await expect(r.api('/file',{},'blob')).rejects.toThrow('Unauthorized access');expect(r.auth.clearAuth).toHaveBeenCalled();expect(r.goto).toHaveBeenCalledWith('/login');
});
