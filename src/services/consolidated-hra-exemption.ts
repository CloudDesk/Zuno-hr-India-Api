/** Report-only HRA formula using actual salary and rent, without an approval-amount cap. */
export function reportHraExemption(basicDA: number, hraReceived: number, rent: number | null, location?: string): number {
    const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
    if (rent === null || !Number.isFinite(rent) || rent < 0) return 0;
    const percentage = /chennai|mumbai|delhi|kolkata/i.test(location || '') ? .5 : .4;
    return money(Math.min(positive(hraReceived), money(positive(basicDA) * percentage), money(Math.max(0, rent - positive(basicDA) * .1))));
}
