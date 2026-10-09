// Synthetic layout/load verification only: no database access and no GCP uploads.
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');
const { buildPdfEmployee } = require('../src/services/consolidated-tax-pdf-calculation');
const { renderConsolidatedTaxPdf } = require('../src/services/consolidated-tax-pdf-renderer');
const { resetPayslipBrowser } = require('../src/services/payslip-pdf-runtime');
const { employee, salary, declaration, payrolls, fy, clone } = require('../test/helpers/consolidated-pdf-fixture');
async function main() {
 const count=Number(process.argv[2] || 125);
 if(!Number.isInteger(count)||count<1||count>1000) throw new Error('Employee count must be between 1 and 1000.');
 const outputDirectory=path.resolve(__dirname,'../tmp/pdfs');fs.mkdirSync(outputDirectory,{recursive:true});
 const employees=Array.from({length:count},(_,index)=>{
  const user={...clone(employee),_id:`synthetic-${index+1}`,name:`Synthetic Employee ${String(index+1).padStart(3,'0')}`,employeeCode:`PDF${String(index+1).padStart(4,'0')}`};
  const d=index%3===2 ? undefined : clone(declaration);
  if(index%3===1){d.regime='new';d.initialTaxBreakdown={totalTaxAmount:0,cessAmount:0,finalTaxWithCess:0};}
  return buildPdfEmployee(user,d,[clone(salary)],clone(payrolls),[],'ABCDE1234F',fy);
 });
 const started=Date.now();const outputPath=path.join(outputDirectory,`consolidated-layout-${count}.pdf`);
 await renderConsolidatedTaxPdf({financialYear:fy,generatedAt:new Date().toISOString(),employer:{name:'Synthetic Layout Company',address:'Synthetic Organisation Office Address, Chennai, India'},employees},outputPath);
 const result={employees:count,pdfPath:outputPath,durationMs:Date.now()-started,sizeBytes:fs.statSync(outputPath).size};
 fs.writeFileSync(path.join(outputDirectory,`consolidated-layout-${count}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await resetPayslipBrowser();});
