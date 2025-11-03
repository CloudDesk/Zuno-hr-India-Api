
const COUNTRY_CURRENCY_MAP: Record<string, { currency: string; locale: string }> = {
    AE: { currency: 'AED', locale: 'en-AE' },
    IN: { currency: 'INR', locale: 'en-IN' },
};

export function formatCurrency(amount: number | null | undefined, country?: string): string {
    // Normalize numeric input; treat null/undefined/non-finite as 0
    const numericAmount = typeof amount === 'number' && Number.isFinite(amount)
        ? amount
        : 0;

    const normalizedCountry = country?.toUpperCase() ?? 'IN';
    const { currency, locale } = COUNTRY_CURRENCY_MAP[normalizedCountry] || COUNTRY_CURRENCY_MAP.IN;

    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
        }).format(numericAmount);
    } catch {
        // Fallback to a simple string if Intl.NumberFormat fails
        return `${currency} ${Math.round(numericAmount)}`;
    }
}
