const FORM12BB_FINANCIAL_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

export function getForm12BBJoiningDateCutoff(financialYear: string): Date {
    const match = FORM12BB_FINANCIAL_YEAR_PATTERN.exec(String(financialYear || '').trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
        throw new Error('Financial year must be a consecutive range in YYYY-YYYY format');
    }

    // The cutoff is exclusive: for FY 2025-2026, anyone joining on or after
    // 01-Apr-2026 is not eligible for that financial year.
    return new Date(Date.UTC(Number(match[2]), 3, 1));
}

export function getForm12BBJoiningDateQuery(financialYear: string): Record<string, unknown> {
    return {
        $exists: true,
        $ne: null,
        $lt: getForm12BBJoiningDateCutoff(financialYear),
    };
}

export function isForm12BBJoiningDateEligible(
    joiningDate: Date | string | null | undefined,
    financialYear: string,
): boolean {
    if (!joiningDate) return false;
    const parsedJoiningDate = new Date(joiningDate);
    return Number.isFinite(parsedJoiningDate.getTime())
        && parsedJoiningDate.getTime() < getForm12BBJoiningDateCutoff(financialYear).getTime();
}

export function assertForm12BBJoiningDateEligible(
    joiningDate: Date | string | null | undefined,
    financialYear: string,
    employeeName = 'Employee',
): void {
    if (isForm12BBJoiningDateEligible(joiningDate, financialYear)) return;

    const parsedJoiningDate = joiningDate ? new Date(joiningDate) : null;
    const joiningDateLabel = parsedJoiningDate && Number.isFinite(parsedJoiningDate.getTime())
        ? parsedJoiningDate.toISOString().slice(0, 10)
        : 'missing or invalid';
    throw new Error(
        `${employeeName} is not eligible for Form 12BB for FY ${financialYear} `
        + `(joining date: ${joiningDateLabel})`,
    );
}
