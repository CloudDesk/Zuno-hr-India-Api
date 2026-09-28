import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';
import { Page, PDFOptions } from 'puppeteer';
import { renderPayslipPdf } from './payslip-pdf-runtime';
import { Form16CalculationResult } from './form16-calculation.service';

export interface Form16PdfData {
    employeeId: string;
    employeeName: string;
    employeeAddress: string;
    employeePan: string;
    employeeCode: string;
    employerName: string;
    employerAddress: string;
    employerEmail: string;
    employerPan: string;
    employerTan: string;
    citName: string;
    citAddress: string;
    financialYear: string;
    assessmentYear: string;
    periodFrom: string;
    periodTo: string;
    optedOutOfNewRegime: boolean;
    generatedAt: string;
    calculation: Form16CalculationResult;
}

handlebars.registerHelper('form16Amount', (value: unknown) => {
    const parsed = Number(value || 0);
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number.isFinite(parsed) ? parsed : 0);
});

let compiledTemplate: handlebars.TemplateDelegate<Form16PdfData> | null = null;

function getTemplate(): handlebars.TemplateDelegate<Form16PdfData> {
    if (!compiledTemplate) {
        const templatePath = path.resolve(__dirname, '../templates/form16/form16.html');
        compiledTemplate = handlebars.compile<Form16PdfData>(fs.readFileSync(templatePath, 'utf8'));
    }
    return compiledTemplate;
}

export async function generateForm16PDF(data: Form16PdfData, outputPath: string): Promise<void> {
    await renderPayslipPdf({
        logContext: {
            userId: data.employeeId,
            month: 0,
            year: Number(data.financialYear.slice(0, 4)),
        },
        outputPath,
        renderPage: async (page: Page): Promise<Omit<PDFOptions, 'path'>> => {
            await page.setContent(getTemplate()(data), { waitUntil: 'networkidle0' });
            await page.emulateMediaType('print');
            return {
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
            };
        },
    });
}
