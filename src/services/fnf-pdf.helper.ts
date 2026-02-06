import { IFinalSettlement } from '../models/final-settlement.model';

import { uploadFileToGCP } from '../utilis/gcpStorage';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import libreoffice from 'libreoffice-convert';
import { promisify } from 'util';
import { formatCurrency } from '../utilis/currency';

// Promisify the libreoffice convert method (it uses callbacks, not Promises)
const convertToPdf = promisify(libreoffice.convert);

// Helper to match Payslip Service Logic
async function convertDocxToPDF(docxPath: string, pdfPath: string): Promise<void> {
    try {
        // Read the DOCX file
        const docxBuffer = fs.readFileSync(docxPath);

        // Convert to PDF using promisified function
        const pdfBuffer = await convertToPdf(docxBuffer, '.pdf', undefined);

        // Write PDF to file
        fs.writeFileSync(pdfPath, pdfBuffer as Buffer);
        console.log(`PDF generated successfully at: ${pdfPath}`);
    } catch (error) {
        console.error('PDF Conversion Error:', error);
        throw error;
    }
}

/**
 * Generate FNF Letter PDF
 */
export async function generateFNFLetter(settlement: IFinalSettlement, employee: any): Promise<string> {
    const fnfDir = path.join(process.cwd(), 'uploads');

    if (!fs.existsSync("uploads")) {
        fs.mkdirSync("uploads", { recursive: true });
    }

    const fnfBaseName = `FNF_${settlement.employeeCode}_${Date.now()}`;
    const outputDocxPath = path.join(fnfDir, `${fnfBaseName}.docx`);
    const outputPdfPath = path.join(fnfDir, `${fnfBaseName}.pdf`);

    // Helper functions


    const formatDate = (date: Date | string | undefined): string => {
        if (!date) return 'N/A';
        const d = new Date(date);
        return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const numberToWords = (num: number): string => {
        if (num === 0) return "zero";
        const belowTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
        const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
        const thousandUnits = ["", "thousand", "million"];

        function helper(n: number): string {
            if (n === 0) return "";
            else if (n < 20) return belowTwenty[n] + " ";
            else if (n < 100) return tens[Math.floor(n / 10)] + " " + helper(n % 10);
            else return belowTwenty[Math.floor(n / 100)] + " hundred " + helper(n % 100);
        }

        let result = "";
        let unitIndex = 0;
        while (num > 0) {
            let chunk = num % 1000;
            if (chunk !== 0) {
                result = helper(chunk) + thousandUnits[unitIndex] + " " + result;
            }
            num = Math.floor(num / 1000);
            unitIndex++;
        }
        return result.trim();
    };

    // Calculate Net Pay in Words
    const netAmount = Math.round(settlement.finalCalculation.netAmount);
    const netPayWords = numberToWords(netAmount);
    const currencyWord = (employee.country === 'AE' || employee.country === 'United Arab Emirates') ? 'Dirhams' : 'Rupees';

    // ✅ Calculate component-wise breakdown from unpaid months
    // ✅ Calculate component-wise breakdown from unpaid months
    const unpaidBasic = settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.components?.basic || 0), 0);
    const unpaidHRA = settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.components?.hra || 0), 0);
    const unpaidConveyance = settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.components?.conveyance || 0), 0);
    const unpaidOtherAllowances = settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.components?.otherAllowances || 0), 0);
    const totalLOPAmount = settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.lopAmount || 0), 0);

    // Prepare template data matching the user's PDF image structure
    const templateData = {
        // Header / Employee Details
        empNo: settlement.employeeCode,
        empName: settlement.employeeName,
        empDept: (employee as any).departmentId?.name || (employee as any).department || 'N/A',
        empDesig: (employee as any).designation || (employee as any).role || 'N/A',
        empLocation: (employee as any).location || 'Chennai',
        joiningDate: formatDate((employee as any).joiningDate),
        resignDate: formatDate(settlement.resignationSubmittedOn),
        leavingDate: formatDate(settlement.leavingDate),

        noticePeriod: settlement.noticePeriodDays > 0 ? settlement.noticePeriodDays : null,
        noticeAdjustable: settlement.excessInNotice < 0 ? Math.abs(settlement.excessInNotice) : null, // Shortfall

        // Days Calculation
        plDays: (settlement.leaveBalance?.reduce((sum: number, l: any) => sum + (l.encashDays || 0), 0) || 0) > 0
            ? settlement.leaveBalance?.reduce((sum: number, l: any) => sum + (l.encashDays || 0), 0)
            : null,
        salaryDays: settlement.unpaidMonths.reduce((sum: number, m: any) => sum + m.daysWorked, 0),
        monthDays: settlement.unpaidMonths.reduce((sum: number, m: any) => sum + (m.totalDays || 0), 0) || 30,
        lopDays: settlement.unpaidMonths.reduce((sum: number, m: any) => sum + m.lopDays, 0) > 0
            ? settlement.unpaidMonths.reduce((sum: number, m: any) => sum + m.lopDays, 0)
            : null,
        effectiveWorkdays: settlement.totalDaysWorked,

        // ✅ INCOME / EARNINGS (Payslip Style)
        income: (() => {
            const iObj: any = {
                // ✅ MOVED INSIDE INCOME SCOPE (User Request: Support {#income}{#unpaidBasic}...{/income})
                unpaidBasic: unpaidBasic > 0 ? formatCurrency(unpaidBasic, 'IN') : null,
                unpaidHRA: unpaidHRA > 0 ? formatCurrency(unpaidHRA, 'IN') : null,
                unpaidOtherAllowance: unpaidOtherAllowances > 0 ? formatCurrency(unpaidOtherAllowances, 'IN') : null,
                total: formatCurrency(settlement.finalCalculation.totalPayable, 'IN')
            };

            if (settlement.finalCalculation.holdSalaries > 0) {
                iObj.holdSalary = formatCurrency(settlement.finalCalculation.holdSalaries, 'IN');
            }
            if (settlement.finalCalculation.reimbursements > 0) {
                iObj.reimbursement = formatCurrency(settlement.finalCalculation.reimbursements, 'IN');
            }
            if (settlement.finalCalculation.leaveEncashment > 0) {
                iObj.leaveEncashment = formatCurrency(settlement.finalCalculation.leaveEncashment, 'IN');
            }
            if (settlement.finalCalculation.otherAdditions > 0) {
                iObj.otherAdditions = formatCurrency(settlement.finalCalculation.otherAdditions, 'IN');
            }

            return iObj;
        })(),

        // Keeping flat variables for backward compatibility and matching your screenshot
        // Keeping flat variables for backward compatibility and matching your screenshot
        // ✅ USER REQUEST: Hide value (return null) if 0
        unpaidBasic: unpaidBasic > 0 ? formatCurrency(unpaidBasic, 'IN') : null,
        unpaidHRA: unpaidHRA > 0 ? formatCurrency(unpaidHRA, 'IN') : null,
        unpaidOtherAllowance: unpaidOtherAllowances > 0 ? formatCurrency(unpaidOtherAllowances, 'IN') : null,
        holdSalary: settlement.finalCalculation.holdSalaries > 0 ? formatCurrency(settlement.finalCalculation.holdSalaries, 'IN') : null,
        leaveEncashment: settlement.finalCalculation.leaveEncashment > 0 ? formatCurrency(settlement.finalCalculation.leaveEncashment, 'IN') : null,
        reimbursements: settlement.finalCalculation.reimbursements > 0 ? formatCurrency(settlement.finalCalculation.reimbursements, 'IN') : null,
        totalIncome: formatCurrency(settlement.finalCalculation.totalPayable, 'IN'),

        // ✅ Flat Deduction Variables (Matches your screenshot exactly)
        pf: (settlement.finalCalculation as any).providentFund > 0 ? formatCurrency((settlement.finalCalculation as any).providentFund, 'IN') : null,
        pt: settlement.finalCalculation.professionalTax > 0 ? formatCurrency(settlement.finalCalculation.professionalTax, 'IN') : null,
        it: (settlement.finalCalculation as any).incomeTax > 0 ? formatCurrency((settlement.finalCalculation as any).incomeTax, 'IN') : null,
        incomeTax: (settlement.finalCalculation as any).incomeTax > 0 ? formatCurrency((settlement.finalCalculation as any).incomeTax, 'IN') : null,
        noticeRecovery: settlement.finalCalculation.noticePeriodRecovery > 0 ? formatCurrency(settlement.finalCalculation.noticePeriodRecovery, 'IN') : null,
        lopDeduction: totalLOPAmount > 0 ? formatCurrency(totalLOPAmount, 'IN') : null,
        otherDeductions: settlement.finalCalculation.otherDeductions > 0 ? formatCurrency(settlement.finalCalculation.otherDeductions, 'IN') : null,
        totalDeductions: formatCurrency(settlement.finalCalculation.totalDeductions, 'IN'),

        // ✅ DEDUCTIONS Object (Matches your screenshot exactly)
        deduction: (() => {
            const dObj: any = {
                total: formatCurrency(settlement.finalCalculation.totalDeductions, 'IN')
            };

            if ((settlement.finalCalculation as any).providentFund > 0) dObj.pf = formatCurrency((settlement.finalCalculation as any).providentFund, 'IN');
            if (settlement.finalCalculation.professionalTax > 0) dObj.pt = formatCurrency(settlement.finalCalculation.professionalTax, 'IN');
            if ((settlement.finalCalculation as any).incomeTax > 0) dObj.it = formatCurrency((settlement.finalCalculation as any).incomeTax, 'IN');
            if (settlement.finalCalculation.noticePeriodRecovery > 0) dObj.noticeRecovery = formatCurrency(settlement.finalCalculation.noticePeriodRecovery, 'IN');
            if (totalLOPAmount > 0) dObj.lopDeduction = formatCurrency(totalLOPAmount, 'IN');
            if (settlement.finalCalculation.otherDeductions > 0) dObj.otherDeduction = formatCurrency(settlement.finalCalculation.otherDeductions, 'IN');

            return dObj;
        })(),

        // Net Summary
        netPay: formatCurrency(netAmount, 'IN'),
        netPayWords: `${currencyWord} ${netPayWords} Only`,

        // Earnings list breakdown
        earningsList: [
            unpaidBasic > 0 ? { label: 'BASIC', amount: formatCurrency(unpaidBasic, 'IN') } : null,
            unpaidHRA > 0 ? { label: 'HRA', amount: formatCurrency(unpaidHRA, 'IN') } : null,
            settlement.finalCalculation.holdSalaries > 0 ? { label: 'HOLD SALARY', amount: formatCurrency(settlement.finalCalculation.holdSalaries, 'IN') } : null,
            unpaidConveyance > 0 ? { label: 'CONVEYANCE', amount: formatCurrency(unpaidConveyance, 'IN') } : null,
            unpaidOtherAllowances > 0 ? { label: 'OTHER ALLOWANCE', amount: formatCurrency(unpaidOtherAllowances, 'IN') } : null,
            settlement.finalCalculation.leaveEncashment > 0 ? { label: 'Leave Encashment', amount: formatCurrency(settlement.finalCalculation.leaveEncashment, 'IN') } : null,
            settlement.finalCalculation.reimbursements !== 0 ? { label: 'Reimbursements', amount: formatCurrency(settlement.finalCalculation.reimbursements, 'IN') } : null,
            settlement.finalCalculation.otherAdditions > 0 ? { label: 'Other Additions', amount: formatCurrency(settlement.finalCalculation.otherAdditions, 'IN') } : null,
            (settlement.finalCalculation as any).gratuity > 0 ? { label: 'Gratuity', amount: formatCurrency((settlement.finalCalculation as any).gratuity, 'IN') } : null,
        ].filter(i => i !== null),

        deductionsList: [
            (settlement.finalCalculation as any).providentFund > 0 ? { label: 'PF', amount: formatCurrency((settlement.finalCalculation as any).providentFund, 'IN') } : null,
            settlement.finalCalculation.professionalTax > 0 ? { label: 'PROF TAX', amount: formatCurrency(settlement.finalCalculation.professionalTax, 'IN') } : null,
            (settlement.finalCalculation as any).incomeTax > 0 ? { label: 'INCOME TAX (TDS)', amount: formatCurrency((settlement.finalCalculation as any).incomeTax, 'IN') } : null,
            (settlement.finalCalculation as any).esi > 0 ? { label: 'ESI', amount: formatCurrency((settlement.finalCalculation as any).esi, 'IN') } : null,
            settlement.finalCalculation.noticePeriodRecovery > 0 ? { label: 'NOTICE PERIOD RECOVERY', amount: formatCurrency(settlement.finalCalculation.noticePeriodRecovery, 'IN') } : null,
            totalLOPAmount > 0 ? { label: 'LOP DEDUCTION', amount: formatCurrency(totalLOPAmount, 'IN') } : null,
            ...(settlement.otherDeductions || [])
                .filter((d: any) => (d.amount || 0) > 0)
                .map((d: any) => ({
                    label: d.description.toUpperCase(),
                    amount: formatCurrency(d.amount, 'IN')
                }))
        ].filter(i => i !== null),
    };

    try {
        console.log("=== START FNF PDF GENERATION ===");

        // Resolve FNF template
        const templateName = 'Final_Settlement.docx';
        const candidates = [
            path.join(process.cwd(), 'templates', templateName),
            path.join(process.cwd(), templateName),
        ];
        console.log("Looking for template in:", candidates);

        let inputPath: string | null = null;
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                inputPath = p;
                console.log("Template FOUND at:", inputPath);
                break;
            }
        }

        if (!inputPath) {
            console.error("TEMPLATE NOT FOUND! Checked:", candidates);
            throw new Error(
                "FNF_Template.docx not found. Place FNF_Template.docx in project root or in templates/ folder."
            );
        }

        console.log("Reading template file...");
        const content = fs.readFileSync(inputPath, "binary");
        console.log("Template read success. Size:", content.length);

        console.log("Initializing PizZip...");
        const zip = new PizZip(content);

        console.log("Initializing Docxtemplater...");
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',
        });

        console.log("Rendering Template...");
        doc.render(templateData);

        console.log("Generating DOCX buffer...");
        const updatedContent = doc.getZip().generate({ type: "nodebuffer" });

        console.log("Writing temp DOCX to:", outputDocxPath);
        fs.writeFileSync(outputDocxPath, updatedContent);

        console.log("Starting LibreOffice Conversion...");

        // USE HELPER METHOD HERE
        await convertDocxToPDF(outputDocxPath, outputPdfPath);

        console.log("PDF Verified Generated and Saved.");

        // Upload to GCP
        console.log("Uploading to GCP...");
        const gcpResult = await uploadFileToGCP({
            filePath: outputPdfPath,
            fileName: `${fnfBaseName}.pdf`,
            employeeId: settlement.employeeId.toString(),
            category: 'Settlement',
            type: 'FNF Letter'
        });
        console.log("GCP Upload Result:", gcpResult);

        // Cleanup
        try {
            await fsPromises.unlink(outputDocxPath);
            await fsPromises.unlink(outputPdfPath);
        } catch (e) { console.warn('Cleanup failed', e); }

        if (!gcpResult.success) {
            throw new Error(`GCP Upload failed: ${gcpResult.error}`);
        }
        return gcpResult.fileUrl!;

    } catch (error: any) {
        console.error('FNF PDF Generation FATAL ERROR:', error);
        return '';
    }
}
