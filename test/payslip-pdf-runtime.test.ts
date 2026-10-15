import puppeteer from 'puppeteer';
import { renderPayslipPdf, resetPayslipBrowser } from '../src/services/payslip-pdf-runtime';
jest.mock('puppeteer',()=>({__esModule:true,default:{launch:jest.fn()}}));
jest.mock('../src/utilis/puppeteer',()=>({getPuppeteerRuntimeConfig:()=>({browserReuse:true,launchOptions:{headless:true},maxConcurrentPdfRenders:1,navigationTimeoutMs:1000,defaultTimeoutMs:1000,pdfTimeoutMs:1000})}));
function session() {
 const page={isClosed:jest.fn(()=>false),close:jest.fn().mockResolvedValue(undefined),setDefaultNavigationTimeout:jest.fn(),setDefaultTimeout:jest.fn(),on:jest.fn(),pdf:jest.fn().mockResolvedValue(Buffer.from('%PDF-'))};
 const browser={newPage:jest.fn().mockResolvedValue(page),close:jest.fn().mockResolvedValue(undefined),isConnected:()=>true,on:jest.fn()};
 return {page,browser};
}
const params={logContext:{userId:'test',month:0,year:2026},outputPath:'unused.pdf',renderPage:async()=>({})};
beforeEach(()=>jest.clearAllMocks());
afterEach(async()=>{await resetPayslipBrowser();});
it('uses and closes a separate browser for each repeated isolated report',async()=>{
 const a=session(),b=session();jest.mocked(puppeteer.launch).mockResolvedValueOnce(a.browser as any).mockResolvedValueOnce(b.browser as any);
 await renderPayslipPdf({...params,isolatedBrowser:true});await renderPayslipPdf({...params,isolatedBrowser:true});
 expect(puppeteer.launch).toHaveBeenCalledTimes(2);for(const s of [a,b]){expect(s.page.close).toHaveBeenCalledTimes(1);expect(s.browser.close).toHaveBeenCalledTimes(1);}
});
it('closes a failed isolated browser and releases the render slot',async()=>{
 const a=session(),b=session();a.page.pdf.mockRejectedValueOnce(new Error('Printing failed'));
 jest.mocked(puppeteer.launch).mockResolvedValueOnce(a.browser as any).mockResolvedValueOnce(b.browser as any);
 await expect(renderPayslipPdf({...params,isolatedBrowser:true})).rejects.toThrow('Printing failed');
 expect(a.page.close).toHaveBeenCalled();expect(a.browser.close).toHaveBeenCalled();
 await renderPayslipPdf({...params,isolatedBrowser:true});expect(b.page.pdf).toHaveBeenCalled();
});
it('preserves browser reuse for callers without isolation',async()=>{
 const a=session();jest.mocked(puppeteer.launch).mockResolvedValue(a.browser as any);
 await renderPayslipPdf(params);await renderPayslipPdf(params);
 expect(puppeteer.launch).toHaveBeenCalledTimes(1);expect(a.browser.close).not.toHaveBeenCalled();
});
