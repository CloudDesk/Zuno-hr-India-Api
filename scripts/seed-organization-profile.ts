import 'dotenv/config';
import mongoose from 'mongoose';
import { OrganizationProfile } from '../src/models/organization-profile.model';

const ORGANIZATION_CODE = 'CLOUDDESK_INDIA';

async function main(): Promise<void> {
    const mongoUri = String(process.env.MONGODB_URI || '').trim();
    if (!mongoUri) throw new Error('MONGODB_URI is required');

    await mongoose.connect(mongoUri);

    const existing = await OrganizationProfile.findOne({ organizationCode: ORGANIZATION_CODE });
    if (existing) {
        console.log(JSON.stringify({
            action: 'unchanged',
            reason: 'Organization Profile already exists',
            id: existing._id.toString(),
            organizationCode: existing.organizationCode,
            status: existing.status,
            database: mongoose.connection.db.databaseName,
        }, null, 2));
        return;
    }

    const activeProfileExists = Boolean(await OrganizationProfile.exists({ status: 'Active' }));
    const profile = await new OrganizationProfile({
        organizationCode: ORGANIZATION_CODE,
        legalName: 'CLOUD DESK TECHNOLOGY PRIVATE LIMITED',
        displayName: 'Cloud Desk Technology',
        country: 'India',
        corporateEmail: 'FINANCE@CLOUDDESK.AE',
        payrollEmail: 'FINANCE@CLOUDDESK.AE',
        addresses: [{
            type: 'payroll',
            label: 'Chennai Payroll Office',
            line1: 'NO 51, NO 51 RATTHA TEK MEADOWS',
            line2: 'RAJIV GANDHI SALAI, SHOLINGANALLUR',
            city: 'CHENNAI',
            state: 'Tamil Nadu',
            postalCode: '600119',
            country: 'India',
            isPrimary: true,
        }],
        statutoryRegistrations: [
            {
                type: 'PAN',
                registrationNumber: 'AAJCC3665M',
                label: 'Employer PAN',
                isPrimary: true,
                isActive: true,
            },
            {
                type: 'TAN',
                registrationNumber: 'CHEC14936F',
                label: 'Employer TAN',
                authority: {
                    name: 'The Commissioner of Income Tax (TDS)',
                    address: '7th Floor, New Block, Aayakar Bhawan, 121, M.G. Road, Chennai - 600034',
                },
                isPrimary: true,
                isActive: true,
            },
        ],
        status: activeProfileExists ? 'Draft' : 'Active',
    }).save();

    console.log(JSON.stringify({
        action: 'created',
        id: profile._id.toString(),
        organizationCode: profile.organizationCode,
        legalName: profile.legalName,
        status: profile.status,
        database: mongoose.connection.db.databaseName,
        note: activeProfileExists
            ? 'An active profile already existed, so this record was created as Draft'
            : 'Created as the only Active Organization Profile',
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
