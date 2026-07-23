export interface IPayslipGenerationResult {
    userId: string;
    status: string;
    documentId?: string;
    pdfPath?: string;
    error?: string;
}

export interface IBulkGenerationResult {
    success: boolean;
    payslips: IPayslipGenerationResult[];
    summary: {
        total: number;
        generated: number;
        failed: number;
        updated: number;
    };
}

export function isEmployeeAllowedForPayslipGeneration(
    employee: { active?: boolean } | null | undefined,
    payrollRecords: Array<{
        status?: string;
        isFinalSettlement?: boolean;
        type?: string;
    }>
): boolean {
    if (employee?.active === true) {
        return true;
    }

    return payrollRecords.some((record) => {
        const isEligibleStatus =
            record?.status === 'Completed' ||
            record?.status === 'Draft';
        const isExplicitFinalSettlement =
            record?.isFinalSettlement === true ||
            record?.type === 'FinalSettlement';

        return isEligibleStatus && isExplicitFinalSettlement;
    });
}

export function buildPayslipGenerationOutcome(
    requestedUserIds: string[],
    results: IPayslipGenerationResult[]
): IBulkGenerationResult {
    // A generated status is not sufficient: the database document must have
    // been saved and returned before this operation can be reported as success.
    const generated = results.filter(
        (result) => result.status === 'Generated' && Boolean(result.documentId)
    ).length;
    const total = requestedUserIds.length;
    const failed = Math.max(0, total - generated);

    return {
        success: total > 0 && generated === total,
        payslips: results,
        summary: {
            total,
            generated,
            failed,
            updated: generated,
        },
    };
}
