import ExcelJS from 'exceljs';
import path from 'path';

export interface POIReportRow {
    section: string;
    description: string;
    declaredAmount: number;
    approvedAmount: number;
    status: 'APPROVED' | '';
    lenderName: string;
    lenderPan: string;
    remarks: string;
    coveredMemberDetails: string;
}

export interface POIReportWorkbookData {
    employeeName: string;
    employeeCode: string;
    financialYear: string;
    regime: string;
    rows: POIReportRow[];
}

function shortFinancialYear(financialYear: string): string {
    const [start, end] = financialYear.split('-');
    return `${start}-${end.slice(-2)}`;
}

export async function generatePOIWorkbook(data: POIReportWorkbookData, outputPath: string): Promise<void> {
    const templatePath = path.resolve(__dirname, '../templates/poi/poi-report.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('POI workbook template does not contain a worksheet');

    const templateStyles = Array.from({ length: 11 }, (_, index) => worksheet.getCell(8, index + 1).style);
    worksheet.getCell('A3').value = `POI Declaration for the Year ${shortFinancialYear(data.financialYear)}`;
    worksheet.getCell('A5').value = 'Proof of Investment declaration and approval details';
    worksheet.getCell('A7').value = `Tax Regime : ${data.regime.toUpperCase()}`;

    for (const merge of ['A25:K25']) {
        try { worksheet.unMergeCells(merge); } catch { /* absent in a revised template */ }
    }
    // Keep the reference template formatting, but remove every sample data value.
    // ExcelJS can retain values after spliceRows when styled/merged template rows
    // are present, so clear the cells explicitly before writing report data.
    const templateLastRow = worksheet.rowCount;
    for (let rowNumber = 8; rowNumber <= templateLastRow; rowNumber += 1) {
        for (let columnNumber = 1; columnNumber <= 11; columnNumber += 1) {
            worksheet.getCell(rowNumber, columnNumber).value = null;
        }
    }

    data.rows.forEach((item, index) => {
        const rowNumber = 8 + index;
        const values: Array<string | number> = [
            index === 0 ? data.employeeName : '',
            index === 0 ? data.employeeCode : '',
            item.section,
            item.description,
            item.status ? item.declaredAmount : '',
            item.status ? item.approvedAmount : '',
            item.status,
            item.lenderName,
            item.lenderPan,
            item.remarks,
            item.coveredMemberDetails,
        ];
        values.forEach((value, columnIndex) => {
            const cell = worksheet.getCell(rowNumber, columnIndex + 1);
            cell.value = value;
            cell.style = { ...(templateStyles[columnIndex] || templateStyles[9]) };
        });
        worksheet.getCell(rowNumber, 4).alignment = { ...worksheet.getCell(rowNumber, 4).alignment, wrapText: true };
        worksheet.getCell(rowNumber, 10).alignment = { ...worksheet.getCell(rowNumber, 10).alignment, wrapText: true };
        worksheet.getCell(rowNumber, 11).alignment = { ...worksheet.getCell(rowNumber, 11).alignment, wrapText: true };
        worksheet.getCell(rowNumber, 5).numFmt = '#,##0.00';
        worksheet.getCell(rowNumber, 6).numFmt = '#,##0.00';
    });

    // Group contiguous subsections under one section label instead of repeating
    // the same section text on every row.
    let sectionStartIndex = 0;
    for (let index = 1; index <= data.rows.length; index += 1) {
        const sectionChanged = index === data.rows.length || data.rows[index].section !== data.rows[sectionStartIndex].section;
        if (!sectionChanged) continue;

        const startRow = 8 + sectionStartIndex;
        const endRow = 7 + index;
        if (endRow > startRow) {
            worksheet.mergeCells(`C${startRow}:C${endRow}`);
            worksheet.getCell(`C${startRow}`).alignment = {
                ...worksheet.getCell(`C${startRow}`).alignment,
                vertical: 'middle',
                wrapText: true,
            };
        }
        sectionStartIndex = index;
    }

    worksheet.pageSetup.orientation = 'landscape';
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 0;
    worksheet.pageSetup.printArea = `A1:K${Math.max(8, 7 + data.rows.length)}`;
    await workbook.xlsx.writeFile(outputPath);
}
