import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { Page, PDFOptions } from 'puppeteer';
import { renderPayslipPdf } from './payslip-pdf-runtime';

// Increment when the persisted PDF layout changes. Existing generated files are
// intentionally left untouched until an admin regenerates them.
export const FORM12BB_TEMPLATE_VERSION = 12;

export interface Form12BBCoveredMember {
    name: string;
    relationship: string;
    age: number;
}

export interface Form12BBLineItem {
    label: string;
    amount: number;
    evidence?: string;
    coveredMembers?: Form12BBCoveredMember[];
}

export interface Form12BBPdfData {
    employeeId: string;
    employeeName: string;
    employeeAddress: string;
    panOrAadhaar: string;
    financialYear: string;
    taxRegime: string;
    rentPaid: number;
    landlordName: string;
    landlordAddress: string;
    landlordPan: string;
    hraEvidence: string;
    ltcAmount: number;
    ltcEvidence: string;
    housingLoanInterest: number;
    housingLoanEvidence: string;
    lenderName: string;
    lenderAddress: string;
    lenderPan: string;
    lenderType: string;
    housePropertyAmount: number;
    housePropertyEvidence: string;
    housePropertyLenderName: string;
    housePropertyLenderPan: string;
    section80C: Form12BBLineItem[];
    section80CCC: Form12BBLineItem[];
    section80CCD: Form12BBLineItem[];
    otherChapterVIA: Form12BBLineItem[];
    otherIncome: number;
    tdsDeduction: number;
    fatherName: string;
    place: string;
    reportDate: string;
    designation: string;
}

handlebars.registerHelper('currency', (value: unknown) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(Number.isFinite(amount) ? amount : 0);
});

handlebars.registerHelper('sumAmounts', (...args: unknown[]) => {
    const itemGroups = args.slice(0, -1) as Form12BBLineItem[][];
    return itemGroups.flat().reduce((total, item) => total + Number(item?.amount || 0), 0);
});

handlebars.registerHelper('joinAllEvidence', (...args: unknown[]) => {
    const itemGroups = args.slice(0, -1) as Form12BBLineItem[][];
    return itemGroups
        .flat()
        .map((item) => item?.evidence)
        .filter(Boolean)
        .join(', ');
});

handlebars.registerHelper('chapterVIARowspan', (...args: unknown[]) => {
    const itemGroups = args.slice(0, -1) as Form12BBLineItem[][];
    return 5 + itemGroups.reduce((total, items) => total + (items?.length || 0), 0);
});

let compiledTemplate: handlebars.TemplateDelegate<Form12BBPdfData> | null = null;

function getForm12BBTemplate(): handlebars.TemplateDelegate<Form12BBPdfData> {
    if (!compiledTemplate) {
        const templatePath = path.resolve(__dirname, '../templates/form12bb/form12bb.html');
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        compiledTemplate = handlebars.compile<Form12BBPdfData>(templateSource);
    }
    return compiledTemplate;
}

export async function generateForm12BBPDF(data: Form12BBPdfData, outputPath: string): Promise<void> {
    const financialYearStart = Number.parseInt(data.financialYear.slice(0, 4), 10) || new Date().getFullYear();

    await renderPayslipPdf({
        logContext: {
            userId: data.employeeId,
            month: 0,
            year: financialYearStart,
        },
        outputPath,
        renderPage: async (page: Page): Promise<Omit<PDFOptions, 'path'>> => {
            await page.setContent(getForm12BBTemplate()(data), { waitUntil: 'networkidle0' });
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
