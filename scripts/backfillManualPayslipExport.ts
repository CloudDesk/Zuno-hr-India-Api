import 'dotenv/config';
import { connectDB } from '../src/config/database';
import { Document } from '../src/models/document.model';
import mongoose from 'mongoose';

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await connectDB();

        // Specific targeting based on user's example
        // _id: 69bba8221312f91d27cee3d6
        // userId: 6929795677a3f81c571e6fce
        // monthYear: 2026-01
        console.log('--- STARTING MANUAL PAYSLIP EXPORT BACKFILL ---');

        //get
        const query = {
            type: 'Payslip',
            $or: [
                { 'isManual': true },
                { 'metadata.payslip.isManual': true },
                { 'metadata.payslip.payrollId': null },
                { 'metadata.payslip.payrollId': { $exists: false } }
            ]
        };

        // -------

        //update
        console.log('Searching for manual payslips...');
        const manualCount = await Document.countDocuments(query);
        
        // Count regular records for user's peace of mind
        const regularCount = await Document.countDocuments({ 
            type: 'Payslip', 
            'metadata.payslip.payrollId': { $exists: true, $ne: null } 
        });

        console.log(`Found ${manualCount} manual payslip records to update.`);
        console.log(`Verified ${regularCount} regular payroll records that WILL NOT be affected.`);

        if (manualCount === 0) {
            console.log('No manual records found to update.');
            await mongoose.connection.close();
            process.exit(0);
        }

        const result = await Document.updateMany(
            query,
            { $set: { 'metadata.payslip.isExport': true } }
        );

        console.log(`Successfully updated ${result.modifiedCount} documents.`);


        console.log('--- MIGRATION COMPLETED ---');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
