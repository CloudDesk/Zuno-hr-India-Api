import { Types } from "mongoose";
import * as fsPromises from "fs/promises";
import path from 'path';
import puppeteer from 'puppeteer';
import handlebars from 'handlebars';
import { RequestContext } from "../types/context";
import { BaseService } from "./base.service";
import { User, Payroll } from "../models";
import { Document } from "../models/document.model";
import { uploadFileToGCP, deleteFileFromGCP } from "../utilis/gcpStorage";
import { formatCurrency } from "../utilis/currency";

interface IPayslipGenerationResult {
    userId: string;
    status: string;
    documentId?: string;
    pdfPath?: string;
    error?: string;
}

interface IBulkGenerationResult {
    success: boolean;
    payslips: IPayslipGenerationResult[];
    summary: {
        total: number;
        generated: number;
        failed: number;
        updated: number;
    };
}

interface IdentityDocumentResult {
    panNumber?: string;
    pfNumber?: string;
    pfUan?: string;
}

export class PayslipPdfService extends BaseService {
    protected context: RequestContext;

    constructor(context: RequestContext) {
        super(context);
        this.context = context;
    }

    async generatePayslip(month: number, year: number, userIds: string[]): Promise<IBulkGenerationResult> {

        console.log(month, year, userIds, "generatePayslip");
        if (month < 1 || month > 12 || year < 2000 || year > 2100) {
            throw new Error('Invalid month (1-12) or year (2000-2100).');
        }

        const lastDayOfMonth = new Date(year, month, 0);

        const employees = await User.find({
            _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
            joiningDate: { $lt: lastDayOfMonth },
        }).populate('departmentId').lean();

        if (!employees.length) {
            throw new Error('No eligible employees found for payslip generation.');
        }

        const payrolls = await Payroll.find({
            month,
            year,
            employeeId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
            status: 'Completed',
        }).lean();

        if (!payrolls.length) {
            throw new Error('No payroll data found for the specified users.');
        }

        const payslipPromises = employees.map(async (employee): Promise<IPayslipGenerationResult> => {
            try {
                const payroll = payrolls.find((p) => p.employeeId.toString() === employee._id.toString());
                if (!payroll) {
                    return { userId: employee._id.toString(), status: 'No Payroll Found' };
                }

                const monthStr = month <= 9 ? `0${month}` : `${month}`;
                const cleanName = employee.name.replace(/[^a-zA-Z0-9]/g, '_');
                const filename = `Doc_Payslip_${employee._id.toString().slice(-5)}_${cleanName}_${year}_${monthStr}.pdf`;
                const tempFilePath = path.resolve(process.cwd(), 'uploads', filename);

                // Ensure uploads directory exists
                await fsPromises.mkdir(path.dirname(tempFilePath), { recursive: true });

                // Generate PDF via HTML
                await this.generatePayslipHtmlToPdf(employee, payroll, tempFilePath);

                // Upload to GCP Cloud Storage
                const gcpResult = await uploadFileToGCP({
                    filePath: tempFilePath,
                    fileName: filename,
                    employeeId: employee._id.toString(),
                    category: 'Payroll',
                    type: 'Payslip'
                });

                if (!gcpResult.success) {
                    throw new Error(`Failed to upload payslip to GCP: ${gcpResult.error}`);
                }

                const fileUrl = gcpResult.fileUrl!;

                let document = await Document.findOne({
                    employeeId: new Types.ObjectId(employee._id),
                    type: 'Payslip',
                    'metadata.payslip.month': month,
                    'metadata.payslip.year': year,
                });

                const documentData = {
                    employeeId: new Types.ObjectId(employee._id),
                    type: 'Payslip' as const,
                    category: 'Payroll' as const,
                    fileName: filename,
                    filePath: fileUrl,
                    tags: ['Payslip', `${year}`, `month-${month}`],
                    uploadDate: new Date(),
                    uploadedBy: new Types.ObjectId(this.context.user?._id || (employee._id as string)),
                    version: document ? (document.version || 1) + 1 : 1,
                    accessLevel: 'Private' as const,
                    status: 'Generated' as const,
                    metadata: {
                        payslip: {
                            payrollId: payroll._id,
                            monthYear: `${year}-${monthStr}`,
                            month,
                            year,
                            netSalary: payroll.netSalary,
                            paySummary: {
                                gross: payroll.monthlyGross,
                                net: payroll.netSalary,
                                deductions: payroll.totalDeductions,
                                bonus: payroll.bonus || 0,
                                reimbursement: payroll.reimbursement || 0,
                            },
                            presentDays: payroll.presentDays,
                            totalDays: payroll.totalDaysInMonth,
                            payableDays: payroll.payableDays,
                            isExport: false,
                        },
                    },
                    auditLog: [
                        ...(document?.auditLog || []),
                        {
                            action: 'Generate' as const,
                            performedBy: new Types.ObjectId(this.context.user?._id || (employee._id as string)),
                            timestamp: new Date(),
                            details: `Payslip generated using HTML-to-PDF for ${employee.name} for ${month}-${year}`,
                        },
                    ],
                };

                if (document) {
                    if (document.filePath) {
                        try {
                            await deleteFileFromGCP(document.filePath);
                        } catch (err) {
                            console.warn(`Failed to delete old file from GCP: ${document.filePath}`, err);
                        }
                    }
                    Object.assign(document, documentData);
                } else {
                    document = new Document(documentData);
                }

                await document.save();

                // Clean up local temp file
                try {
                    await fsPromises.unlink(tempFilePath);
                } catch (e) {
                    console.warn('Cleanup of temp PDF failed', e);
                }

                return {
                    userId: employee._id.toString(),
                    status: 'Generated',
                    documentId: document._id.toString(),
                };
            } catch (error: any) {
                console.error(`Error generating payslip for ${employee._id}:`, error);
                return {
                    userId: employee._id.toString(),
                    status: 'Error',
                    error: error.message,
                };
            }
        });

        const results = await Promise.all(payslipPromises);

        return {
            success: true,
            payslips: results,
            summary: {
                total: userIds.length,
                generated: results.filter((r) => r.status === 'Generated').length,
                failed: results.filter((r) => r.status === 'Error').length,
                updated: results.filter((r) => r.status === 'Generated' && r.documentId).length,
            },
        };
    }

    private async generatePayslipHtmlToPdf(employee: any, payroll: any, outputPath: string): Promise<void> {
        const normalizedCountry = (payroll.country as string)?.toUpperCase() || 'IN';
        const isUaePayroll = normalizedCountry === 'AE';

        const formatLabel = (input: any): string => {
            if (!input) return '-';
            if (typeof input === 'object' && input.name) return input.name;
            const str = String(input);
            if (['undefined', 'null', 'n/a', 'na', '-'].includes(str.toLowerCase())) return '-';
            return str;
        };

        const sanitizeAmount = (value: unknown): number => {
            if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
            if (typeof value === 'string') {
                const numeric = Number(value.trim().replace(/,/g, ''));
                return Number.isFinite(numeric) ? numeric : 0;
            }
            return 0;
        };

        const activeBankData = employee.bankDetails?.find((bank: any) => bank?.isActive);
        const govtIds = await this.getIdentityDocuments(employee._id.toString());

        // Core values mapped from old service logic
        const basicValue = sanitizeAmount(payroll.basic);
        const hraValue = sanitizeAmount(payroll.hra);
        const daValue = sanitizeAmount(payroll.da);
        const otherAllowanceValue = sanitizeAmount(payroll.otherAllowance);
        const travelAllowanceValue = sanitizeAmount(payroll.travelAllowance);
        const holdSalaryValue = sanitizeAmount(payroll.holdSalary);
        const reimbursementValue = sanitizeAmount(payroll.reimbursement);
        const airTicketAllowanceValue = sanitizeAmount(payroll.airTicketAllowance);
        const medicalAllowanceValue = sanitizeAmount(payroll.medicalAllowance);

        const assignedBasicValue = sanitizeAmount(payroll.assigned?.basic);
        const assignedHraValue = sanitizeAmount(payroll.assigned?.hra);
        const assignedOtherAllowanceValue = sanitizeAmount(payroll.assigned?.otherAllowance);
        const assignedTravelAllowanceValue = sanitizeAmount(payroll.assigned?.travelAllowance);
        const assignedReimbursementValue = sanitizeAmount(payroll.assigned?.reimbursementAllowance);
        const assignedAirTicketValue = sanitizeAmount(payroll.assigned?.airTicketAllowance);
        const assignedMedicalValue = sanitizeAmount(payroll.assigned?.medicalAllowance);

        const netPayNumeric = Math.round(sanitizeAmount(payroll.netSalary));
        const netPayWordsRaw = await this.numberToWords(netPayNumeric);
        const netPayWords = netPayNumeric > 0
            ? `${isUaePayroll ? 'Dirhams' : 'Rupees'} ${netPayWordsRaw} only`
            : `${isUaePayroll ? 'Dirhams' : 'Rupees'} ${netPayWordsRaw}`;

        const templateData = {
            empName: formatLabel(employee.name),
            empJoinDate: employee.joiningDate ? new Date(employee.joiningDate).toISOString().split('T')[0] : 'N/A',
            empRole: formatLabel(employee.specificRole) || formatLabel(employee.role),
            empDept: formatLabel(employee.departmentId),
            empLocation: formatLabel(employee.location),
            empNo: formatLabel(employee.employeeCode) || formatLabel(employee.biometricId),
            bankName: formatLabel(activeBankData?.bankName),
            bankAccNo: formatLabel(activeBankData?.accountNumber),
            panNo: formatLabel(govtIds.panNumber) || formatLabel(employee.governmentIds?.pan?.number),
            pfNo: formatLabel(employee.pfNumber) || formatLabel(govtIds.pfNumber) || formatLabel(employee.governmentIds?.pf?.number),
            pfUan: formatLabel(employee.uanNumber) || formatLabel(govtIds.pfUan) || formatLabel(employee.governmentIds?.pf?.uan),
            payMonth: this.getMonthName(payroll.month),
            payYear: payroll.year.toString(),
            daysPresent: payroll.presentDays || 0,
            effectiveWorkDays: payroll.payableDays || (payroll.totalDaysInMonth - (payroll.lopDays || 0)) || 0,
            lopDays: payroll.lopDays || 0,

            income: {
                total: formatCurrency(payroll.monthlyGross || 0, normalizedCountry),
                fullTotal: formatCurrency(
                    assignedBasicValue +
                    assignedHraValue +
                    assignedOtherAllowanceValue +
                    assignedTravelAllowanceValue +
                    assignedReimbursementValue +
                    assignedAirTicketValue +
                    assignedMedicalValue +
                    holdSalaryValue,
                    normalizedCountry
                )
            },
            deduction: {
                total: formatCurrency(payroll.totalDeductions || 0, normalizedCountry)
            },

            allEarnings: (() => {
                const arr: any[] = [];
                const pushIfValid = (label: string, actual: number, full: number) => {
                    if (actual > 0 || full > 0) {
                        arr.push({ label, fullAmount: formatCurrency(full, normalizedCountry), actualAmount: formatCurrency(actual, normalizedCountry) });
                    }
                };
                pushIfValid('BASIC', basicValue, assignedBasicValue);
                pushIfValid('HRA', hraValue, assignedHraValue);
                if (daValue > 0) pushIfValid('DEARNESS ALLOWANCE', daValue, 0);
                pushIfValid('OTHER ALLOWANCE', otherAllowanceValue, assignedOtherAllowanceValue);
                pushIfValid('TRAVEL ALLOWANCE', travelAllowanceValue, assignedTravelAllowanceValue);
                if (holdSalaryValue > 0) pushIfValid('HOLD SALARY', holdSalaryValue, holdSalaryValue);
                if (reimbursementValue > 0) pushIfValid('REIMBURSEMENT', reimbursementValue, assignedReimbursementValue);
                if (airTicketAllowanceValue > 0 || assignedAirTicketValue > 0) pushIfValid('AIR TICKET ALLOWANCE', airTicketAllowanceValue, assignedAirTicketValue);
                if (medicalAllowanceValue > 0 || assignedMedicalValue > 0) pushIfValid('MEDICAL ALLOWANCE', medicalAllowanceValue, assignedMedicalValue);

                return arr;
            })(),

            allDeductions: (() => {
                const arr: any[] = [];
                const pf = Number(payroll.epfEmployee || 0);
                const lop = Number(payroll.leaveDeductions || 0);
                const pt = Number(payroll.professionalTax || 0);
                const it = Number(payroll.incomeTax || 0);
                const tds = Number(payroll.tdsDeduction || 0);
                const notice = Number(payroll.noticePeriodRecovery || 0);

                if (pf > 0) arr.push({ label: 'PROVIDENT FUND', amount: formatCurrency(pf, normalizedCountry) });
                if (lop > 0) arr.push({ label: 'LOSS OF PAY', amount: formatCurrency(lop, normalizedCountry) });
                if (it > 0) arr.push({ label: 'INCOME TAX', amount: formatCurrency(it, normalizedCountry) });
                if (pt > 0) arr.push({ label: 'PROFESSIONAL TAX', amount: formatCurrency(pt, normalizedCountry) });
                if (tds > 0) arr.push({ label: 'TDS (1%)', amount: formatCurrency(tds, normalizedCountry) });
                if (notice > 0) arr.push({ label: 'NOTICE PERIOD RECOVERY', amount: formatCurrency(notice, normalizedCountry) });

                return arr;
            })(),

            netPay: formatCurrency(payroll.netSalary || 0, normalizedCountry),
            netPayWords: netPayWords
        };

        const templatePath = path.join(process.cwd(), 'src', 'emails', 'templates', 'payslip.hbs');
        console.log(`[PAYSLIP_DEBUG] Loading template from: ${templatePath}`);
        
        const templateHtml = await fsPromises.readFile(templatePath, 'utf-8');
        console.log(`[PAYSLIP_DEBUG] Template content begins with: ${templateHtml.substring(0, 100).replace(/\n/g, ' ')}...`);
        const compiledTemplate = handlebars.compile(templateHtml);
        const html = compiledTemplate(templateData);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            await page.pdf({
                path: outputPath,
                format: 'A4',
                printBackground: true,
                margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
            });
        } finally {
            await browser.close();
        }
    }

    private getMonthName(monthNumber: number): string {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return monthNames[monthNumber - 1] || 'Unknown';
    }

    private async numberToWords(num: number): Promise<string> {
        if (num === 0) return "zero";
        const belowTwenty = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
        const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
        const thousandUnits = ["", "thousand", "million", "billion"];

        function helper(n: number): string {
            if (n === 0) return "";
            if (n < 20) return belowTwenty[n] + " ";
            if (n < 100) return tens[Math.floor(n / 10)] + " " + helper(n % 10);
            return belowTwenty[Math.floor(n / 100)] + " hundred " + helper(n % 100);
        }

        let result = "";
        let unitIndex = 0;
        let tempNum = num;
        while (tempNum > 0) {
            let chunk = tempNum % 1000;
            if (chunk !== 0) {
                result = helper(chunk) + thousandUnits[unitIndex] + " " + result;
            }
            tempNum = Math.floor(tempNum / 1000);
            unitIndex++;
        }
        return result.trim();
    }

    private getIdentityDocuments = async (employeeId: string): Promise<IdentityDocumentResult> => {
        try {
            if (!Types.ObjectId.isValid(employeeId)) {
                throw new Error('Invalid employeeId');
            }

            const docs = await Document.find({
                employeeId: new Types.ObjectId(employeeId),
                category: 'Certification',
                'metadata.certificate.certificateType': 'IdentityProof',
            }).lean();

            if (!docs || docs.length === 0) {
                return { panNumber: undefined, pfNumber: undefined, pfUan: undefined };
            }

            const result: IdentityDocumentResult = {};

            docs.forEach((doc: any) => {
                if (doc.metadata?.certificate?.idDetails) {
                    const { idType, idNumber, uanNumber } = doc.metadata.certificate.idDetails;

                    if (idType === 'PAN' && idNumber) {
                        result.panNumber = idNumber;
                    } else if (idType === 'PF' && idNumber) {
                        result.pfNumber = idNumber;
                        result.pfUan = uanNumber;
                    }
                }
            });

            return result;
        } catch (error) {
            console.error('Error fetching identity documents:', error);
            return {};
        }
    };
}
