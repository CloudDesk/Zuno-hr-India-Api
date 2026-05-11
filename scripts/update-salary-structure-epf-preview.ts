import 'dotenv/config';
import { connectDB } from '../src/config/database';
import { SalaryStructure } from '../src/models/salary-structure.model';
import mongoose from 'mongoose';

async function previewSalaryStructureUpdate() {
    try {
        console.log('🚀 SALARY STRUCTURE EPF UPDATE - PREVIEW MODE\n');
        await connectDB();

        const query = {
            country: 'IN',
            'statutoryDeductions.epf.employerContribution': { $ne: 13 }
        };

        const structures = await SalaryStructure.find(query).lean();
        
        console.log(`🔍 Found ${structures.length} salary structures for India that need updating.\n`);

        if (structures.length > 0) {
            console.log('📊 CHANGE PREVIEW:');
            console.log('--------------------------------------------------------------------------------');
            console.log('| Name                           | Current Employer % | Target Employer % |');
            console.log('--------------------------------------------------------------------------------');

            for (const struct of structures) {
                const current = struct.statutoryDeductions.epf.employerContribution;
                console.log(`| ${struct.name.padEnd(30)} | ${String(current).padEnd(18)} | ${String(13).padEnd(17)} |`);
            }

            console.log('--------------------------------------------------------------------------------');
        } else {
            console.log('✅ All India salary structures already have employer contribution set to 13.');
        }

        console.log('\n⚠️  NO DATABASE CHANGES WERE APPLIED.');
        console.log('To apply these changes, run the execution script.');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Preview failed:', error);
        process.exit(1);
    }
}

previewSalaryStructureUpdate();
