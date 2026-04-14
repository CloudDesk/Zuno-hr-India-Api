import { Payroll } from '../src/models/payrolls.model';

/**
 * Migration Utility: Updates the 'type' field for all existing payroll records.
 * if isFinalSettlement is true => type = 'FinalSettlement'
 * else => type = 'Regular'
 */
export async function migratePayrollType() {
    try {
        console.log('Starting Payroll Type migration...');

        //get
        const fnfQuery = { isFinalSettlement: true };
        const regularQuery = { isFinalSettlement: { $ne: true } };

        // -------

        //update

        // 1. Update Final Settlement records
        const fnfResult = await Payroll.updateMany(
            fnfQuery,
            { $set: { type: 'FinalSettlement' } }
        );
        console.log(`Updated ${fnfResult.modifiedCount} records to 'FinalSettlement'`);

        // 2. Update Regular records
        const regularResult = await Payroll.updateMany(
            regularQuery,
            { $set: { type: 'Regular' } }
        );
        console.log(`Updated ${regularResult.modifiedCount} records to 'Regular'`);

        console.log('Payroll Type migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

