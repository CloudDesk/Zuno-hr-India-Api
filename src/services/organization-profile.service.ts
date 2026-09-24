import mongoose, { Types } from 'mongoose';
import { BaseService } from './base.service';
import { RequestContext } from '../types/context';
import {
    IOrganizationAddress,
    IOrganizationProfile,
    IStatutoryRegistration,
    OrganizationProfile,
} from '../models/organization-profile.model';

export interface OrganizationProfileInput {
    organizationCode: string;
    legalName: string;
    displayName?: string;
    country?: string;
    corporateEmail?: string;
    payrollEmail?: string;
    phone?: string;
    website?: string;
    addresses?: IOrganizationAddress[];
    statutoryRegistrations?: IStatutoryRegistration[];
    documentSettings?: IOrganizationProfile['documentSettings'];
}

export interface Form16EmployerProfile {
    organizationProfileId: string;
    organizationProfileVersion: number;
    name: string;
    address: string;
    email: string;
    pan: string;
    tan: string;
    citName: string;
    citAddress: string;
}

const PROFILE_INPUT_KEYS: Array<keyof OrganizationProfileInput> = [
    'organizationCode',
    'legalName',
    'displayName',
    'country',
    'corporateEmail',
    'payrollEmail',
    'phone',
    'website',
    'addresses',
    'statutoryRegistrations',
    'documentSettings',
];

const pickProfileInput = (input: Partial<OrganizationProfileInput>): Partial<OrganizationProfileInput> =>
    PROFILE_INPUT_KEYS.reduce((result, key) => {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
            (result as any)[key] = input[key];
        }
        return result;
    }, {} as Partial<OrganizationProfileInput>);

const assertActivationReady = (profile: IOrganizationProfile): void => {
    const primaryAddress = profile.addresses.some(
        (item) => item.isPrimary && ['payroll', 'registered'].includes(item.type),
    );
    const primaryPans = profile.statutoryRegistrations.filter(
        (item) => item.type === 'PAN' && item.isActive && item.isPrimary,
    );
    const primaryTans = profile.statutoryRegistrations.filter(
        (item) => item.type === 'TAN' && item.isActive && item.isPrimary,
    );
    const missing: string[] = [];
    if (!profile.legalName) missing.push('legalName');
    if (!primaryAddress) missing.push('primary payroll or registered address');
    if (primaryPans.length !== 1) missing.push('one primary active PAN');
    if (primaryTans.length !== 1) missing.push('one primary active TAN');
    if (primaryTans.length === 1 && (!primaryTans[0].authority?.name || !primaryTans[0].authority?.address)) {
        missing.push('TAN authority name and address');
    }
    if (missing.length) {
        throw new Error(`Organization Profile cannot be active. Configure: ${missing.join(', ')}`);
    }
};

const formatAddress = (address: IOrganizationAddress): string => [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
].map((part) => String(part || '').trim()).filter(Boolean).join(', ');

const financialYearRange = (financialYear: string): { from: Date; to: Date } => {
    const startYear = Number(financialYear.slice(0, 4));
    return {
        from: new Date(Date.UTC(startYear, 3, 1)),
        to: new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)),
    };
};

const isApplicableRegistration = (
    registration: IStatutoryRegistration,
    range: { from: Date; to: Date },
): boolean => registration.isActive &&
    registration.isPrimary &&
    (!registration.effectiveFrom || new Date(registration.effectiveFrom) <= range.to) &&
    (!registration.effectiveTo || new Date(registration.effectiveTo) >= range.from);

export const mapOrganizationProfileToForm16Employer = (
    profile: IOrganizationProfile | any,
    financialYear: string,
): Form16EmployerProfile => {
    const addresses = (profile.addresses || []) as IOrganizationAddress[];
    const address = addresses.find((item) => item.isPrimary && item.type === 'payroll')
        || addresses.find((item) => item.isPrimary && item.type === 'registered');
    const range = financialYearRange(financialYear);
    const registrations = (profile.statutoryRegistrations || []) as IStatutoryRegistration[];
    const pans = registrations.filter((item) => item.type === 'PAN' && isApplicableRegistration(item, range));
    const tans = registrations.filter((item) => item.type === 'TAN' && isApplicableRegistration(item, range));
    const missing: string[] = [];

    if (!String(profile.legalName || '').trim()) missing.push('legalName');
    if (!address) missing.push('primary payroll or registered address');
    if (pans.length !== 1) missing.push('one applicable primary active PAN');
    if (tans.length !== 1) missing.push('one applicable primary active TAN');
    if (tans.length === 1 && !String(tans[0].authority?.name || '').trim()) missing.push('TAN authority name');
    if (tans.length === 1 && !String(tans[0].authority?.address || '').trim()) missing.push('TAN authority address');

    if (missing.length) {
        throw new Error(`Organization Profile is incomplete for Form 16. Configure: ${missing.join(', ')}`);
    }

    return {
        organizationProfileId: String(profile._id),
        organizationProfileVersion: Number(profile.version || 0),
        name: String(profile.legalName).trim(),
        address: formatAddress(address!),
        email: String(profile.payrollEmail || profile.corporateEmail || '').trim(),
        pan: String(pans[0].registrationNumber).trim().toUpperCase(),
        tan: String(tans[0].registrationNumber).trim().toUpperCase(),
        citName: String(tans[0].authority!.name).trim(),
        citAddress: String(tans[0].authority!.address).trim(),
    };
};

export class OrganizationProfileService extends BaseService {
    constructor(context: RequestContext) {
        super(context);
    }

    private adminId(): Types.ObjectId {
        if (String(this.context.user?.role || '').toLowerCase() !== 'admin' || !this.context.user?._id) {
            throw new Error('Only administrators can manage the Organization Profile');
        }
        return new Types.ObjectId(this.context.user._id);
    }

    async list(): Promise<IOrganizationProfile[]> {
        this.adminId();
        return OrganizationProfile.find().sort({ status: 1, updatedAt: -1 });
    }

    async getActive(): Promise<IOrganizationProfile | null> {
        this.adminId();
        return OrganizationProfile.findOne({ status: 'Active' });
    }

    async create(input: OrganizationProfileInput): Promise<IOrganizationProfile> {
        const adminId = this.adminId();
        return new OrganizationProfile({
            ...pickProfileInput(input),
            status: 'Draft',
            createdBy: adminId,
            updatedBy: adminId,
        }).save();
    }

    async update(id: string, input: Partial<OrganizationProfileInput>, expectedVersion?: number): Promise<IOrganizationProfile> {
        const adminId = this.adminId();
        if (!Types.ObjectId.isValid(id)) throw new Error('A valid Organization Profile ID is required');
        const profile = await OrganizationProfile.findById(id);
        if (!profile) throw new Error('Organization Profile not found');
        if (expectedVersion !== undefined && profile.version !== expectedVersion) {
            throw new Error('Organization Profile was updated by another request. Refresh and try again');
        }
        Object.assign(profile, pickProfileInput(input), { updatedBy: adminId });
        if (profile.status === 'Active') assertActivationReady(profile);
        return profile.save();
    }

    async activate(id: string): Promise<IOrganizationProfile> {
        const adminId = this.adminId();
        if (!Types.ObjectId.isValid(id)) throw new Error('A valid Organization Profile ID is required');
        const session = await mongoose.startSession();
        try {
            let activated: IOrganizationProfile | null = null;
            await session.withTransaction(async () => {
                const profile = await OrganizationProfile.findById(id).session(session);
                if (!profile) throw new Error('Organization Profile not found');

                // Activation is also the readiness gate for the current financial year-independent
                // fields. Registration effective dates are checked again for each Form 16 FY.
                assertActivationReady(profile);

                await OrganizationProfile.updateMany(
                    { _id: { $ne: profile._id }, status: 'Active' },
                    { $set: { status: 'Inactive', updatedBy: adminId }, $inc: { version: 1 } },
                    { session },
                );
                profile.status = 'Active';
                profile.updatedBy = adminId;
                activated = await profile.save({ session });
            });
            if (!activated) throw new Error('Unable to activate Organization Profile');
            return activated;
        } finally {
            await session.endSession();
        }
    }

    async deactivate(id: string): Promise<IOrganizationProfile> {
        const adminId = this.adminId();
        if (!Types.ObjectId.isValid(id)) throw new Error('A valid Organization Profile ID is required');
        const profile = await OrganizationProfile.findById(id);
        if (!profile) throw new Error('Organization Profile not found');
        profile.status = 'Inactive';
        profile.updatedBy = adminId;
        return profile.save();
    }

    static async resolveForm16Employer(financialYear: string): Promise<Form16EmployerProfile> {
        const profiles = await OrganizationProfile.find({ status: 'Active' }).limit(2).lean();
        if (!profiles.length) {
            throw new Error('No active Organization Profile found. Configure and activate one in Admin Setup');
        }
        if (profiles.length > 1) {
            throw new Error('Multiple active Organization Profiles found. Keep only one profile active');
        }
        return mapOrganizationProfileToForm16Employer(profiles[0], financialYear);
    }
}
