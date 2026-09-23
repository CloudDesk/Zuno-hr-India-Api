const FORM12B_FINANCIAL_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

export function getForm12BJoiningDateRange(financialYear: string): { start: Date; end: Date } {
    const match = FORM12B_FINANCIAL_YEAR_PATTERN.exec(String(financialYear || '').trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
        throw new Error('Financial year must be a consecutive range in YYYY-YYYY format');
    }

    return {
        start: new Date(Date.UTC(Number(match[1]), 3, 1)),
        end: new Date(Date.UTC(Number(match[2]), 3, 1)),
    };
}

export function getForm12BJoiningDateQuery(financialYear: string): Record<string, Date> {
    const { start, end } = getForm12BJoiningDateRange(financialYear);
    return { $gte: start, $lt: end };
}

export function assertForm12BJoiningDateEligible(
    joiningDate: Date | string | null | undefined,
    financialYear: string,
    employeeName = 'Employee',
): void {
    const { start, end } = getForm12BJoiningDateRange(financialYear);
    const parsedJoiningDate = joiningDate ? new Date(joiningDate) : null;
    const isEligible = Boolean(
        parsedJoiningDate
        && Number.isFinite(parsedJoiningDate.getTime())
        && parsedJoiningDate >= start
        && parsedJoiningDate < end,
    );
    if (isEligible) return;

    const joiningDateLabel = parsedJoiningDate && Number.isFinite(parsedJoiningDate.getTime())
        ? parsedJoiningDate.toISOString().slice(0, 10)
        : 'missing or invalid';
    throw new Error(
        `${employeeName} is not eligible for Form 12B for FY ${financialYear} `
        + `(joining date: ${joiningDateLabel})`,
    );
}
