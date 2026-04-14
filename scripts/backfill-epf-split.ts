import 'dotenv/config';
import { connectDB } from '../src/config/database';
import { Payroll } from '../src/models/payrolls.model';
import mongoose from 'mongoose';

async function backfillEpfSplit() {
    try {
        console.log('--- STARTING EPF/EPS SPLIT BACKFILL ---');
        await connectDB();

        //get
        const query = {
            country: 'IN',
            $or: [
                { epfEmployerEps: { $exists: false } },
                { epfEmployerEps: 0 }
            ]
        };

        // 1. DATA CLEANUP (ALWAYS RUN FIRST): Reset any records with negative EPF (Consultancy/Interns affected by previous run)
        const cleanupResult = await Payroll.updateMany(
            { country: 'IN', epfEmployerEpf: { $lt: 0 } },
            { $set: { epfEmployerEps: 0, epfEmployerEpf: 0 } }
        );
        if (cleanupResult.modifiedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanupResult.modifiedCount} records with incorrect negative values.`);
        }

        const totalToUpdate = await Payroll.countDocuments(query);
        console.log(`Found ${totalToUpdate} Indian payroll records needing EPF/EPS split backfill.`);

        // -------

        //update
        if (totalToUpdate === 0) {
            console.log('No more records need to be updated.');
            await mongoose.connection.close();
            process.exit(0);
        }

        const cursor = await Payroll.find(query).cursor();
        let updatedCount = 0;

        for (let record = await cursor.next(); record != null; record = await cursor.next()) {
            const basicPlusDa = (record.basic || 0) + (record.da || 0);
            const epfTotal = (record.epfEmployer || 0);
            
            let epsValue = 0;
            let epfValue = 0;

            // Logic: Skip calculation if employer contribution is 0 or less (Consultancy/Interns)
            if (epfTotal > 0) {
                const epsPercentage = 8.33;
                const epsWageCap = 15000;
                const currentWageForEps = Math.min(basicPlusDa, epsWageCap);
                epsValue = Number(((epsPercentage / 100) * currentWageForEps).toFixed(2));
                epfValue = Number((epfTotal - epsValue).toFixed(2));
            }

            await Payroll.updateOne(
                { _id: record._id },
                { 
                    $set: { 
                        epfEmployerEps: epsValue,
                        epfEmployerEpf: epfValue
                    } 
                }
            );

            updatedCount++;
            if (updatedCount % 50 === 0) {
                console.log(`Processed ${updatedCount}/${totalToUpdate} records...`);
            }
        }


        console.log(`\nSuccessfully backfilled EPF split for ${updatedCount} records.`);
        console.log('--- BACKFILL COMPLETED ---');
        
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Backfill failed:', error);
        process.exit(1);
    }
}

backfillEpfSplit();
