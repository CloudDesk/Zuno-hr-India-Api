/** Preserve the existing Form 12B behavior: only verified previous-employer
 * TDS is credited, and the resulting tax cannot be negative. */
export function applyForm12BTDS(taxWithCess: number, tdsDeducted: number): number {
    return Math.max(0, taxWithCess - tdsDeducted);
}
