import Fastify from 'fastify';
import { consolidatedTaxPdfRoutes } from '../src/routes/consolidated-tax-pdf.routes';
import { generateConsolidatedPdf, getConsolidatedPdfStatus, getConsolidatedPdfUrl } from '../src/services/consolidated-tax-pdf.service';
import { financialYearRange } from '../src/services/consolidated-tax-calculation';
jest.mock('../src/middleware/auth',()=>({authenticate:jest.fn(async(request:any,reply:any)=>{
 if(request.headers.authorization!=='Bearer test')return reply.code(401).send({success:false,message:'Unauthenticated'});
 request.user={role:request.headers['x-test-role']||'admin',name:'Test Admin',_id:'admin-1'};
})}));
jest.mock('../src/services/consolidated-tax-pdf.service',()=>({generateConsolidatedPdf:jest.fn(),getConsolidatedPdfStatus:jest.fn(),getConsolidatedPdfUrl:jest.fn()}));
const headers={authorization:'Bearer test'};
const app=Fastify();
beforeAll(async()=>{await app.register(consolidatedTaxPdfRoutes,{prefix:'/consolidated-tax-pdf'});await app.ready();});
afterAll(async()=>{await app.close();});
beforeEach(()=>{
 jest.resetAllMocks();
 jest.spyOn(Date,'now').mockReturnValue(Date.parse('2030-04-01T00:00:00+05:30'));
 // Keep authentication implementation because the module's hook is already registered.
 const {authenticate}=require('../src/middleware/auth');authenticate.mockImplementation(async(request:any,reply:any)=>{
  if(request.headers.authorization!=='Bearer test')return reply.code(401).send({success:false,message:'Unauthenticated'});
  request.user={role:request.headers['x-test-role']||'admin',name:'Test Admin',_id:'admin-1'};
 });
 jest.mocked(getConsolidatedPdfStatus).mockImplementation(async year=>{financialYearRange(year);return {financialYear:year,exists:true,isGenerating:false,revision:1,employeeCount:2,reviewCount:0,fileName:undefined,generatedAt:undefined,generatedByName:undefined};});
 jest.mocked(getConsolidatedPdfUrl).mockResolvedValue('https://example.test/signed.pdf');
 jest.mocked(generateConsolidatedPdf).mockResolvedValue({financialYear:'2026-2027',exists:true,isGenerating:false,revision:2,employeeCount:2,reviewCount:0,fileName:undefined,generatedAt:undefined,generatedByName:undefined});
});
afterEach(()=>{jest.restoreAllMocks();});
it.each([
 ['2027-03-31T18:29:59.999Z',400],
 ['2027-03-31T18:30:00.000Z',200],
])('uses the exact India FY closing boundary at %s',async(time,expected)=>{
 jest.spyOn(Date,'now').mockReturnValue(Date.parse(time));
 const r=await app.inject({method:'GET',url:'/consolidated-tax-pdf/status?financialYear=2026-2027',headers});
 expect(r.statusCode).toBe(expected);
 if(expected===400)expect(getConsolidatedPdfStatus).not.toHaveBeenCalled();
});
it.each(['status','preview','download'])('blocks %s before FY closes and allows the India date boundary',async action=>{
 const before=await app.inject({method:'GET',url:`/consolidated-tax-pdf/${action}?financialYear=2026-2027&testDate=2027-03-31`,headers});
 expect(before.statusCode).toBe(400);expect(before.json().message).toContain('1 April 2027');
 expect(getConsolidatedPdfStatus).not.toHaveBeenCalled();expect(getConsolidatedPdfUrl).not.toHaveBeenCalled();
 const after=await app.inject({method:'GET',url:`/consolidated-tax-pdf/${action}?financialYear=2026-2027&testDate=2027-04-01`,headers});expect(after.statusCode).toBe(200);
});
it('uses actual date again when testing date is omitted',async()=>{
 jest.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-08T12:00:00+05:30'));
 const test=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027',testDate:'2027-04-01'}});
 expect(test.statusCode).toBe(200);expect(generateConsolidatedPdf).toHaveBeenCalledWith('2026-2027','Test Admin');jest.mocked(generateConsolidatedPdf).mockClear();
 const actual=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027'}});
 expect(actual.statusCode).toBe(400);expect(generateConsolidatedPdf).not.toHaveBeenCalled();
});
it('blocks generation before the testing date reaches FY close',async()=>{
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027',testDate:'2027-03-31'}});
 expect(r.statusCode).toBe(400);expect(generateConsolidatedPdf).not.toHaveBeenCalled();
});
it.each(['2027-02-29','2027-04-31','2027-13-01','not-a-date'])('rejects invalid testing date %s',async testDate=>{
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027',testDate}});
 expect(r.statusCode).toBe(400);expect(generateConsolidatedPdf).not.toHaveBeenCalled();
});
it('accepts a real leap-day testing date for a closed FY',async()=>{
 const r=await app.inject({method:'GET',url:'/consolidated-tax-pdf/status?financialYear=2026-2027&testDate=2028-02-29',headers});expect(r.statusCode).toBe(200);
});
it.each(['status','preview','download'])('allows an authenticated admin to access %s',async action=>{
 const r=await app.inject({method:'GET',url:`/consolidated-tax-pdf/${action}?financialYear=2026-2027`,headers});expect(r.statusCode).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(r.json().success).toBe(true);
});
it('allows admin PDF generation with validated JSON',async()=>{
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027'}});
 expect(r.statusCode).toBe(200);expect(generateConsolidatedPdf).toHaveBeenCalledWith('2026-2027','Test Admin');
});
it.each(['status','preview','download'])('rejects unauthenticated %s requests',async action=>{
 const r=await app.inject({method:'GET',url:`/consolidated-tax-pdf/${action}?financialYear=2026-2027`});expect(r.statusCode).toBe(401);expect(getConsolidatedPdfUrl).not.toHaveBeenCalled();expect(getConsolidatedPdfStatus).not.toHaveBeenCalled();
});
it.each(['employee','manager','staff'])('rejects the %s role without generating',async role=>{
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers:{...headers,'x-test-role':role},payload:{financialYear:'2026-2027'}});
 expect(r.statusCode).toBe(403);expect(generateConsolidatedPdf).not.toHaveBeenCalled();
});
it.each(['','invalid','2026/2027','<script>'])('rejects missing or malformed FY %s',async year=>{
 const r=await app.inject({method:'GET',url:`/consolidated-tax-pdf/status?financialYear=${encodeURIComponent(year)}`,headers});expect(r.statusCode).toBe(400);expect(getConsolidatedPdfStatus).not.toHaveBeenCalled();
});
it('rejects a non-consecutive financial year through service validation',async()=>{
 const r=await app.inject({method:'GET',url:'/consolidated-tax-pdf/status?financialYear=2026-2028',headers});expect(r.statusCode).toBe(400);
});
it('rejects a generation request without its required financial year',async()=>{
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{}});expect(r.statusCode).toBe(400);expect(generateConsolidatedPdf).not.toHaveBeenCalled();
});
it('reports generation errors without claiming success',async()=>{
 jest.mocked(generateConsolidatedPdf).mockRejectedValueOnce(new Error('Upload failed'));
 const r=await app.inject({method:'POST',url:'/consolidated-tax-pdf/generate',headers,payload:{financialYear:'2026-2027'}});expect(r.statusCode).toBe(400);expect(r.json()).toMatchObject({success:false,message:'Upload failed'});
});
it('reports a missing saved PDF on download',async()=>{
 jest.mocked(getConsolidatedPdfUrl).mockRejectedValueOnce(new Error('Generate the PDF first'));
 const r=await app.inject({method:'GET',url:'/consolidated-tax-pdf/download?financialYear=2026-2027',headers});expect(r.statusCode).toBe(400);expect(r.json().message).toContain('Generate');
});
it('requests attachment disposition for download and inline viewing for preview',async()=>{
 await app.inject({method:'GET',url:'/consolidated-tax-pdf/download?financialYear=2026-2027',headers});expect(getConsolidatedPdfUrl).toHaveBeenLastCalledWith('2026-2027',true);
 await app.inject({method:'GET',url:'/consolidated-tax-pdf/preview?financialYear=2026-2027',headers});expect(getConsolidatedPdfUrl).toHaveBeenLastCalledWith('2026-2027',false);
});
