import { Payroll } from '../models/payrolls.model';

/**
 * Migration Utility: Updates the 'type' field for all existing payroll records.
 * if isFinalSettlement is true => type = 'FinalSettlement'
 * else => type = 'Regular'
 */
export async function migratePayrollType() {
    try {
        console.log('Starting Payroll Type migration...');

        // 1. Update Final Settlement records
        const fnfResult = await Payroll.updateMany(
            { isFinalSettlement: true },
            { $set: { type: 'FinalSettlement' } }
        );
        console.log(`Updated ${fnfResult.modifiedCount} records to 'FinalSettlement'`);

        // 2. Update Regular records (where type is missing or not FinalSettlement)
        const regularResult = await Payroll.updateMany(
            { isFinalSettlement: { $ne: true } },
            { $set: { type: 'Regular' } }
        );
        console.log(`Updated ${regularResult.modifiedCount} records to 'Regular'`);

        console.log('Payroll Type migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}
