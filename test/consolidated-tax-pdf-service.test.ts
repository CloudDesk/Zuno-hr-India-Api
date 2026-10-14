import { loadConsolidatedPdfData, generateConsolidatedPdf, getConsolidatedPdfStatus, getConsolidatedPdfUrl } from '../src/services/consolidated-tax-pdf.service';
import { User } from '../src/models/user.model';
import { TaxDeclaration } from '../src/models/tax-declaration';
import { SalaryAssignment } from '../src/models/salary-assignments.model';
import { Payroll } from '../src/models/payrolls.model';
import { Document } from '../src/models/document.model';
import { OrganizationProfile } from '../src/models/organization-profile.model';
import { ConsolidatedTaxPdf } from '../src/models/consolidated-tax-pdf.model';
import { renderConsolidatedTaxPdf } from '../src/services/consolidated-tax-pdf-renderer';
import { uploadFileToGCP, deleteFileFromGCP, getSignedFileUrl } from '../src/utilis/gcpStorage';
import * as fs from 'fs/promises';
import { fy, employee, salary, declaration, payrolls, clone } from './helpers/consolidated-pdf-fixture';
jest.mock('../src/models/user.model',()=>({User:{find:jest.fn()}}));
jest.mock('../src/models/tax-declaration',()=>({TaxDeclaration:{find:jest.fn()}}));
jest.mock('../src/models/salary-assignments.model',()=>({SalaryAssignment:{find:jest.fn()}}));
jest.mock('../src/models/payrolls.model',()=>({Payroll:{find:jest.fn()}}));
jest.mock('../src/models/document.model',()=>({Document:{find:jest.fn()}}));
jest.mock('../src/models/organization-profile.model',()=>({OrganizationProfile:{find:jest.fn()}}));
jest.mock('../src/models/consolidated-tax-pdf.model',()=>({ConsolidatedTaxPdf:{findById:jest.fn(),findOneAndUpdate:jest.fn(),updateOne:jest.fn()}}));
jest.mock('../src/services/consolidated-tax-pdf-renderer',()=>({renderConsolidatedTaxPdf:jest.fn()}));
jest.mock('../src/utilis/gcpStorage',()=>({uploadFileToGCP:jest.fn(),deleteFileFromGCP:jest.fn(),getSignedFileUrl:jest.fn()}));
jest.mock('fs/promises',()=>({mkdir:jest.fn(),unlink:jest.fn(),rmdir:jest.fn()}));
function query(data: unknown) { const chain:any={lean:jest.fn().mockResolvedValue(data)};for(const name of ['select','sort','limit','populate'])chain[name]=jest.fn().mockReturnValue(chain);return chain; }
const profile={legalName:'Organisation Legal Name',addresses:[{isPrimary:true,type:'payroll',line1:'Office Road',line2:'Floor 2',city:'Chennai',state:'Tamil Nadu',postalCode:'600119',country:'IN'},{isPrimary:true,type:'registered',line1:'Registered Road'}]};
const oldUrl='https://storage.googleapis.com/example/old.pdf',newUrl='https://storage.googleapis.com/example/new.pdf';
beforeEach(()=>{
 jest.resetAllMocks();
 (User.find as jest.Mock).mockReturnValue(query([employee,{...employee,_id:'employee-2',employeeCode:'CD0002'}]));
 (TaxDeclaration.find as jest.Mock).mockReturnValue(query([clone(declaration)]));
 (SalaryAssignment.find as jest.Mock).mockReturnValue(query([clone(salary)]));
 (Payroll.find as jest.Mock).mockReturnValue(query(clone(payrolls)));(Document.find as jest.Mock).mockReturnValue(query([]));
 (OrganizationProfile.find as jest.Mock).mockReturnValue(query([clone(profile)]));
 (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query({_id:fy,fileUrl:oldUrl,fileName:'old.pdf',revision:1}));
 (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReturnValueOnce(query({_id:fy,fileUrl:oldUrl,revision:1})).mockReturnValue(query({_id:fy,fileUrl:newUrl,revision:2,employeeCount:2}));
 (ConsolidatedTaxPdf.updateOne as jest.Mock).mockResolvedValue({});
 jest.mocked(renderConsolidatedTaxPdf).mockResolvedValue(undefined);
 jest.mocked(uploadFileToGCP).mockResolvedValue({success:true,fileUrl:newUrl});
 jest.mocked(deleteFileFromGCP).mockResolvedValue({success:true});
 jest.mocked(getSignedFileUrl).mockResolvedValue('signed-url');
 (fs.mkdir as jest.Mock).mockResolvedValue(undefined);(fs.unlink as jest.Mock).mockResolvedValue(undefined);(fs.rmdir as jest.Mock).mockResolvedValue(undefined);
});
describe('PDF source selection',()=>{
 it('selects actual payroll components and shows zero when payroll is absent',async()=>{
  const chain=query([]);(Payroll.find as jest.Mock).mockReturnValue(chain);
  const data=await loadConsolidatedPdfData(fy);expect(data.employees[0].gross).toBe(0);expect(data.employees[0].totalTax).toBe(52260);
  const selected=chain.select.mock.calls[0][0].split(' ');for(const field of ['basic','hra','da','otherAllowance','travelAllowance','reimbursementAllowance','status'])expect(selected).toContain(field);
 });
 it('loads all FY employees including missing declarations, with batched read-only queries',async()=>{
  const data=await loadConsolidatedPdfData(fy);expect(data.employees).toHaveLength(2);
  expect(data.employees[0].incomeTax).toBe(50250);expect(data.employees[1].totalTax).toBe(0);
  for(const source of [TaxDeclaration,SalaryAssignment,Payroll,Document,OrganizationProfile])expect((source as any).find).toHaveBeenCalledTimes(1);
  expect(TaxDeclaration.find).toHaveBeenCalledWith({employeeId:{$in:['employee-1','employee-2']},financialYear:fy});
  expect(data.employer).toEqual({name:'Organisation Legal Name',address:'Office Road, Floor 2, Chennai, Tamil Nadu, 600119, IN'});
 });
 it('uses the India fiscal-year eligibility boundary and includes inactive employees',async()=>{
  await loadConsolidatedPdfData(fy);const filter=(User.find as jest.Mock).mock.calls[0][0];
  expect(filter).not.toHaveProperty('active');expect(filter.country).toBe('IN');
  expect(filter.$and[0].$or[0].joiningDate.$lte.toISOString()).toBe('2027-03-31T18:29:59.999Z');
  expect(filter.$and[1].$or[0].separationDate.$gte.toISOString()).toBe('2026-03-31T18:30:00.000Z');
  expect((Payroll.find as jest.Mock).mock.calls[0][0].$or).toEqual([{year:2026,month:{$gte:4,$lte:12}},{year:2027,month:{$gte:1,$lte:3}}]);
 });
 it('uses the primary registered address if no primary payroll address exists',async()=>{
  (OrganizationProfile.find as jest.Mock).mockReturnValue(query([{legalName:'Legal Name',addresses:[{type:'registered',isPrimary:true,line1:'Registered Office',city:'City'}]}]));
  expect((await loadConsolidatedPdfData(fy)).employer.address).toBe('Registered Office, City');
 });
 it.each([
  {joiningDate:'2018-06-15',separationDate:'2027-03-31',include:false},
  {joiningDate:'2028-04-01',separationDate:null,include:true},
  {joiningDate:'2029-04-01',separationDate:null,include:false},
  {joiningDate:'2018-06-15',separationDate:'2028-04-01T00:00:00+05:30',include:true},
 ])('selects FY 2028–2029 employees by employment overlap: %p',async ({joiningDate,separationDate,include})=>{
  (User.find as jest.Mock).mockImplementation((filter:any)=>{
   const end=filter.$and[0].$or[0].joiningDate.$lte,start=filter.$and[1].$or[0].separationDate.$gte;
   const eligible=new Date(joiningDate)<=end&&(!separationDate||new Date(separationDate)>=start);
   return query(eligible?[{...employee,joiningDate,separationDate}]:[]);
  });
  if(include)expect((await loadConsolidatedPdfData('2028-2029')).employees).toHaveLength(1);
  else await expect(loadConsolidatedPdfData('2028-2029')).rejects.toThrow('No eligible employees');
 });
 it.each([{profiles:[]},{profiles:[profile,profile]}])('rejects missing or ambiguous active organisations',async ({profiles})=>{
  (OrganizationProfile.find as jest.Mock).mockReturnValue(query(profiles));await expect(loadConsolidatedPdfData(fy)).rejects.toThrow('exactly one active');
 });
 it.each([{legalName:'Name',addresses:[]},{addresses:profile.addresses},{legalName:'Name'}])('rejects incomplete organisation details: %p',async incomplete=>{
  (OrganizationProfile.find as jest.Mock).mockReturnValue(query([incomplete]));await expect(loadConsolidatedPdfData(fy)).rejects.toThrow('legal name and primary');
 });
 it('rejects an empty employee selection without a PDF upload',async()=>{
  (User.find as jest.Mock).mockReturnValue(query([]));await expect(loadConsolidatedPdfData(fy)).rejects.toThrow('No eligible employees');expect(uploadFileToGCP).not.toHaveBeenCalled();
 });
 it('uses PAN document fallback',async()=>{
  (User.find as jest.Mock).mockReturnValue(query([{...employee,governmentIds:{}}]));
  (Document.find as jest.Mock).mockReturnValue(query([{employeeId:employee._id,type:'Certification',metadata:{certificate:{idDetails:{idNumber:'ZZZZZ1234Z'}}}}]));
  expect((await loadConsolidatedPdfData(fy)).employees[0].pan).toBe('ZZZZZ1234Z');
 });
 it('retains an employee with duplicate declarations, showing dependent amounts zero',async()=>{
  (TaxDeclaration.find as jest.Mock).mockReturnValue(query([clone(declaration),clone(declaration)]));
  const e=(await loadConsolidatedPdfData(fy)).employees[0];expect(e.incomeTax).toBe(0);expect(e.gross).toBe(2400000);expect(e.warnings.join(' ')).toContain('Multiple FY declarations');
 });
 it('does not abort on incomplete Form12B metadata',async()=>{
  (Document.find as jest.Mock).mockReturnValue(query([{employeeId:employee._id,type:'Form12B',metadata:{}}]));
  const e=(await loadConsolidatedPdfData(fy)).employees[0];expect(e.previousIncome).toBe(0);expect(e.incomeTax).toBe(50250);
 });

});
describe('PDF generation and cached downloads',()=>{
 it('renders once, uploads once, and publishes before removing the prior file',async()=>{
  const result=await generateConsolidatedPdf(fy,'Admin');expect(result).toMatchObject({exists:true,revision:2,employeeCount:2});
  expect(renderConsolidatedTaxPdf).toHaveBeenCalledTimes(1);expect(uploadFileToGCP).toHaveBeenCalledTimes(1);
  expect(jest.mocked(uploadFileToGCP).mock.calls[0][0]).toMatchObject({employeeId:'consolidated-tax-pdf',public:false,cacheControl:'no-store, max-age=0'});
  const commit=(ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mock.calls[1];expect(commit[0].generationToken).toBeTruthy();expect(commit[1].$set.employeeCount).toBe(2);
  expect(jest.mocked(deleteFileFromGCP).mock.invocationCallOrder[0]).toBeGreaterThan((ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mock.invocationCallOrder[1]);
  expect(deleteFileFromGCP).toHaveBeenCalledWith(oldUrl);expect(ConsolidatedTaxPdf.updateOne).toHaveBeenCalled();expect(fs.unlink).toHaveBeenCalled();expect(fs.rmdir).toHaveBeenCalled();
 });
 it('does not delete the old PDF when rendering fails',async()=>{
  jest.mocked(renderConsolidatedTaxPdf).mockRejectedValueOnce(new Error('Render failed'));
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Render failed');expect(uploadFileToGCP).not.toHaveBeenCalled();expect(deleteFileFromGCP).not.toHaveBeenCalled();expect(ConsolidatedTaxPdf.updateOne).toHaveBeenCalled();
 });
 it('keeps the old PDF when GCP upload fails',async()=>{
  jest.mocked(uploadFileToGCP).mockResolvedValueOnce({success:false,error:'Upload failed'});
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Upload failed');expect(deleteFileFromGCP).not.toHaveBeenCalled();expect(ConsolidatedTaxPdf.findOneAndUpdate).toHaveBeenCalledTimes(1);
 });
 it('releases the lease even if temporary-directory creation fails',async()=>{
  (fs.mkdir as jest.Mock).mockRejectedValueOnce(new Error('Disk unavailable'));await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Disk unavailable');expect(ConsolidatedTaxPdf.updateOne).toHaveBeenCalled();expect(renderConsolidatedTaxPdf).not.toHaveBeenCalled();
 });
 it('rejects a simultaneous generation lease without any render or upload',async()=>{
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValue(query(null));
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Another administrator');expect(renderConsolidatedTaxPdf).not.toHaveBeenCalled();expect(fs.mkdir).not.toHaveBeenCalled();
 });
 it('handles a duplicate-key race on lease acquisition',async()=>{
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValue({lean:jest.fn().mockRejectedValue({code:11000})});
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Another administrator');expect(uploadFileToGCP).not.toHaveBeenCalled();
 });
 it('removes only the candidate when commit is superseded',async()=>{
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({_id:fy,fileUrl:oldUrl})).mockReturnValueOnce(query(null));
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('superseded');expect(deleteFileFromGCP).toHaveBeenCalledWith(newUrl);expect(deleteFileFromGCP).not.toHaveBeenCalledWith(oldUrl);
 });
 it('does not remove an uploaded file when a DB commit succeeded but acknowledgement failed',async()=>{
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({_id:fy,fileUrl:oldUrl})).mockReturnValueOnce({lean:jest.fn().mockRejectedValue(new Error('Network'))});
  (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query({fileUrl:newUrl}));
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Network');expect(deleteFileFromGCP).not.toHaveBeenCalled();
 });
 it('retains the candidate when its commit state cannot be determined',async()=>{
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({_id:fy,fileUrl:oldUrl})).mockReturnValueOnce(query(null));
  (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue({lean:jest.fn().mockRejectedValue(new Error('DB unavailable'))});
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('superseded');expect(deleteFileFromGCP).not.toHaveBeenCalled();
 });
 it('returns success even if cleanup of the old file fails',async()=>{
  jest.mocked(deleteFileFromGCP).mockRejectedValueOnce(new Error('Cleanup failed'));await expect(generateConsolidatedPdf(fy,'Admin')).resolves.toMatchObject({exists:true});
 });
 it.each([false,true])('opens saved PDFs without regeneration, download=%s',async download=>{
  expect(await getConsolidatedPdfUrl(fy,download)).toBe('signed-url');expect(getSignedFileUrl).toHaveBeenCalledWith(oldUrl,download?{downloadFileName:`Consolidated_Tax_Report_${fy}.pdf`}:{});expect(renderConsolidatedTaxPdf).not.toHaveBeenCalled();expect(User.find).not.toHaveBeenCalled();
 });
 it('rejects download when no PDF exists',async()=>{
  (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query(null));await expect(getConsolidatedPdfUrl(fy)).rejects.toThrow('Generate the PDF');
 });
 it('does not expose private storage URLs in status',async()=>{
  const r=await getConsolidatedPdfStatus(fy);expect(r.exists).toBe(true);expect(r).not.toHaveProperty('fileUrl');
 });
 it.each(['invalid','2026-2028'])('rejects invalid FY %s before querying storage',async year=>{
  await expect(getConsolidatedPdfUrl(year)).rejects.toThrow();expect(ConsolidatedTaxPdf.findById).not.toHaveBeenCalled();
 });
});

describe('100-employee PDF parts',()=>{
 it.each([1,100,101,200,250])('generates %s employees exactly once across bounded parts',async count=>{
  const users=Array.from({length:count},(_,i)=>({...employee,_id:`employee-${i+1}`,employeeCode:`CD${i+1}`}));
  (User.find as jest.Mock).mockReturnValue(query(users));
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({fileUrl:oldUrl})).mockImplementation((_filter:any,update:any)=>query({...update.$set,revision:2}));
  jest.mocked(uploadFileToGCP).mockImplementation(async args=>({success:true,fileUrl:`https://storage.googleapis.com/example/${args.fileName}`}));
  const result=await generateConsolidatedPdf(fy,'Admin');
  expect(result.partCount).toBe(Math.ceil(count/100));expect(result.employeeCount).toBe(count);
  const batches=jest.mocked(renderConsolidatedTaxPdf).mock.calls.map(([data])=>data.employees);
  expect(batches.every(batch=>batch.length>0&&batch.length<=100)).toBe(true);
  expect(batches.flat().map(e=>e.id)).toEqual(users.map(u=>u._id));
  expect(result.parts.map(p=>[p.firstEmployee,p.lastEmployee])).toEqual(batches.map((batch,i)=>[i*100+1,i*100+batch.length]));
  expect(result.parts.every(p=>!('fileUrl' in p))).toBe(true);
  expect(uploadFileToGCP).toHaveBeenCalledTimes(result.partCount);
 });
 it('keeps the previous set if a later part fails and cleans up new uploads',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(Array.from({length:101},(_,i)=>({...employee,_id:`employee-${i+1}`}))));
  jest.mocked(uploadFileToGCP).mockResolvedValueOnce({success:true,fileUrl:newUrl}).mockResolvedValueOnce({success:false,error:'Part 2 failed'});
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Part 2 failed');
  expect(ConsolidatedTaxPdf.findOneAndUpdate).toHaveBeenCalledTimes(1);expect(deleteFileFromGCP).toHaveBeenCalledWith(newUrl);expect(deleteFileFromGCP).not.toHaveBeenCalledWith(oldUrl);
 });
 it('signs the selected part only with its distinct download filename',async()=>{
  (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query({parts:[{part:1,fileUrl:oldUrl},{part:2,fileUrl:newUrl}]}));
  await getConsolidatedPdfUrl(fy,true,2);expect(getSignedFileUrl).toHaveBeenCalledWith(newUrl,{downloadFileName:`Consolidated_Tax_Report_${fy}_Part_2.pdf`});
  await expect(getConsolidatedPdfUrl(fy,false,3)).rejects.toThrow('unavailable');
  await expect(getConsolidatedPdfUrl(fy,false,0)).rejects.toThrow('Invalid PDF part');
 });
 it('retains every committed part after an uncertain commit acknowledgment',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(Array.from({length:101},(_,i)=>({...employee,_id:`employee-${i+1}`}))));
  jest.mocked(uploadFileToGCP).mockResolvedValueOnce({success:true,fileUrl:newUrl}).mockResolvedValueOnce({success:true,fileUrl:'part-two-url'});
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({fileUrl:oldUrl})).mockReturnValueOnce({lean:jest.fn().mockRejectedValue(new Error('Network'))});
  (ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query({parts:[{part:1,fileUrl:newUrl},{part:2,fileUrl:'part-two-url'}]}));
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Network');expect(deleteFileFromGCP).not.toHaveBeenCalled();
 });
});

describe('PDF upload pipeline',()=>{
 it('renders the next part while the prior upload runs and publishes only after uploads finish',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(Array.from({length:101},(_,i)=>({...employee,_id:`employee-${i+1}`}))));
  let finishFirst!: (value:any)=>void;
  jest.mocked(uploadFileToGCP).mockImplementationOnce(()=>new Promise(resolve=>{finishFirst=resolve;})).mockResolvedValueOnce({success:true,fileUrl:'part-two-url'});
  jest.mocked(renderConsolidatedTaxPdf).mockResolvedValueOnce(undefined).mockImplementationOnce(async()=>{
   expect(uploadFileToGCP).toHaveBeenCalledTimes(1);expect(ConsolidatedTaxPdf.findOneAndUpdate).toHaveBeenCalledTimes(1);
   finishFirst({success:true,fileUrl:newUrl});
  });
  await generateConsolidatedPdf(fy,'Admin');
  const commit=(ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mock.calls[1][1].$set;
  expect(commit.parts.map((p:any)=>p.fileUrl)).toEqual([newUrl,'part-two-url']);
 });
 it('settles an in-flight upload before cleanup if the next render fails',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(Array.from({length:101},(_,i)=>({...employee,_id:`employee-${i+1}`}))));
  let finishFirst!: (value:any)=>void;
  jest.mocked(uploadFileToGCP).mockImplementationOnce(()=>new Promise(resolve=>{finishFirst=resolve;}));
  jest.mocked(renderConsolidatedTaxPdf).mockResolvedValueOnce(undefined).mockImplementationOnce(async()=>{
   finishFirst({success:true,fileUrl:newUrl});throw new Error('Part 2 render failed');
  });
  await expect(generateConsolidatedPdf(fy,'Admin')).rejects.toThrow('Part 2 render failed');
  expect(deleteFileFromGCP).toHaveBeenCalledWith(newUrl);expect(deleteFileFromGCP).not.toHaveBeenCalledWith(oldUrl);
  expect(ConsolidatedTaxPdf.findOneAndUpdate).toHaveBeenCalledTimes(1);
 });
});

describe('selected PDF part generation',()=>{
 const users=()=>Array.from({length:128},(_,i)=>({...employee,_id:`employee-${i+1}`,employeeCode:`CD${i+1}`}));
 it('loads only Part 2 payroll and generates its 28 reports while retaining Part 1',async()=>{
  const employees=users();(User.find as jest.Mock).mockReturnValue(query(employees));
  const previous={employeeCount:128,employeeIds:employees.map(u=>u._id),parts:[{part:1,fileUrl:oldUrl,fileName:'part1.pdf',employeeCount:100,firstEmployee:1,lastEmployee:100,reviewCount:0},{part:2,fileUrl:'old-part2-url',fileName:'part2.pdf',employeeCount:28,firstEmployee:101,lastEmployee:128,reviewCount:0}]};
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query(previous)).mockImplementation((_filter:any,update:any)=>query({...update.$set,revision:3}));
  const r=await generateConsolidatedPdf(fy,'Admin',2);
  expect(renderConsolidatedTaxPdf).toHaveBeenCalledTimes(1);
  const data=jest.mocked(renderConsolidatedTaxPdf).mock.calls[0][0];expect(data.employees.map(e=>e.id)).toEqual(employees.slice(100).map(u=>u._id));
  expect((Payroll.find as jest.Mock).mock.calls[0][0].employeeId.$in).toEqual(employees.slice(100).map(u=>u._id));
  expect(r.employeeCount).toBe(128);expect(r.parts.map(p=>p.part)).toEqual([1,2]);
  expect(deleteFileFromGCP).toHaveBeenCalledWith('old-part2-url');expect(deleteFileFromGCP).not.toHaveBeenCalledWith(oldUrl);
  const committed=(ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mock.calls[1][1].$set.parts;expect(committed[0]).toEqual(previous.parts[0]);
 });
 it('allows generating Part 2 first and exposes Part 1 as not yet generated',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(users()));
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({})).mockImplementation((_filter:any,update:any)=>query({...update.$set,revision:1}));
  const r=await generateConsolidatedPdf(fy,'Admin',2);
  expect(r.parts.map(p=>p.part)).toEqual([2]);expect(r.availableParts).toEqual([{part:1,firstEmployee:1,lastEmployee:100,employeeCount:100,exists:false},{part:2,firstEmployee:101,lastEmployee:128,employeeCount:28,exists:true}]);
 });
 it('provides choices before any PDF is generated',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(users()));(ConsolidatedTaxPdf.findById as jest.Mock).mockReturnValue(query(null));
  const r=await getConsolidatedPdfStatus(fy);expect(r.exists).toBe(false);expect(r.availableParts.map(p=>p.employeeCount)).toEqual([100,28]);
 });
 it('rejects a changed roster without overwriting any part',async()=>{
  (User.find as jest.Mock).mockReturnValue(query(users()));
  (ConsolidatedTaxPdf.findOneAndUpdate as jest.Mock).mockReset().mockReturnValueOnce(query({employeeIds:['different-employee']}));
  await expect(generateConsolidatedPdf(fy,'Admin',2)).rejects.toThrow('Select All parts');expect(renderConsolidatedTaxPdf).not.toHaveBeenCalled();expect(deleteFileFromGCP).not.toHaveBeenCalled();
 });
 it.each([0,-1,1.5,3])('rejects invalid or unavailable selected part %s',async part=>{
  (User.find as jest.Mock).mockReturnValue(query(users()));await expect(generateConsolidatedPdf(fy,'Admin',part)).rejects.toThrow();expect(renderConsolidatedTaxPdf).not.toHaveBeenCalled();
 });
});
