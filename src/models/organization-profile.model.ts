import { Document, model, Schema, Types } from 'mongoose';

export const ORGANIZATION_ADDRESS_TYPES = [
    'registered',
    'corporate',
    'payroll',
    'branch',
] as const;

export const STATUTORY_REGISTRATION_TYPES = [
    'PAN',
    'TAN',
    'CIN',
    'GSTIN',
    'EPFO',
    'ESIC',
    'PROFESSIONAL_TAX',
] as const;

export type OrganizationAddressType = typeof ORGANIZATION_ADDRESS_TYPES[number];
export type StatutoryRegistrationType = typeof STATUTORY_REGISTRATION_TYPES[number];
export type OrganizationProfileStatus = 'Draft' | 'Active' | 'Inactive';

export interface IOrganizationAddress {
    _id?: Types.ObjectId;
    type: OrganizationAddressType;
    label?: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isPrimary: boolean;
}

export interface IRegistrationAuthority {
    name?: string;
    address?: string;
    jurisdictionCode?: string;
}

export interface IStatutoryRegistration {
    _id?: Types.ObjectId;
    type: StatutoryRegistrationType;
    registrationNumber: string;
    label?: string;
    locationCode?: string;
    authority?: IRegistrationAuthority;
    effectiveFrom?: Date;
    effectiveTo?: Date;
    isPrimary: boolean;
    isActive: boolean;
}

export interface IDocumentSettings {
    logoPath?: string;
    letterheadPath?: string;
    authorizedSignatoryName?: string;
    authorizedSignatoryDesignation?: string;
    signaturePath?: string;
}

export interface IOrganizationProfile extends Document {
    organizationCode: string;
    legalName: string;
    displayName?: string;
    country: string;
    corporateEmail?: string;
    payrollEmail?: string;
    phone?: string;
    website?: string;
    addresses: IOrganizationAddress[];
    statutoryRegistrations: IStatutoryRegistration[];
    documentSettings?: IDocumentSettings;
    status: OrganizationProfileStatus;
    createdBy?: Types.ObjectId;
    updatedBy?: Types.ObjectId;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

const normalizeUppercase = (value: unknown): string => String(value || '').trim().toUpperCase();

const RegistrationAuthoritySchema = new Schema<IRegistrationAuthority>({
    name: { type: String, trim: true, maxlength: 250 },
    address: { type: String, trim: true, maxlength: 1000 },
    jurisdictionCode: { type: String, trim: true, maxlength: 100 },
}, { _id: false });

const OrganizationAddressSchema = new Schema<IOrganizationAddress>({
    type: {
        type: String,
        enum: ORGANIZATION_ADDRESS_TYPES,
        required: true,
    },
    label: { type: String, trim: true, maxlength: 100 },
    line1: { type: String, required: true, trim: true, maxlength: 250 },
    line2: { type: String, trim: true, maxlength: 250 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true, trim: true, maxlength: 20 },
    country: { type: String, required: true, trim: true, maxlength: 100, default: 'India' },
    isPrimary: { type: Boolean, default: false },
});

const StatutoryRegistrationSchema = new Schema<IStatutoryRegistration>({
    type: {
        type: String,
        enum: STATUTORY_REGISTRATION_TYPES,
        required: true,
    },
    registrationNumber: {
        type: String,
        required: true,
        trim: true,
        set: normalizeUppercase,
        validate: {
            validator: function (this: IStatutoryRegistration, value: string): boolean {
                if (this.type === 'PAN') return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value);
                if (this.type === 'TAN') return /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(value);
                if (this.type === 'GSTIN') return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value);
                if (this.type === 'CIN') return /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(value);
                return value.length > 0;
            },
            message: ({ value, path }: { value: unknown; path: string }) =>
                `Invalid statutory registration value '${String(value)}' for ${path}`,
        },
    },
    label: { type: String, trim: true, maxlength: 100 },
    locationCode: { type: String, trim: true, maxlength: 100 },
    authority: { type: RegistrationAuthoritySchema, default: undefined },
    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
});

const DocumentSettingsSchema = new Schema<IDocumentSettings>({
    logoPath: { type: String, trim: true, maxlength: 1000 },
    letterheadPath: { type: String, trim: true, maxlength: 1000 },
    authorizedSignatoryName: { type: String, trim: true, maxlength: 200 },
    authorizedSignatoryDesignation: { type: String, trim: true, maxlength: 200 },
    signaturePath: { type: String, trim: true, maxlength: 1000 },
}, { _id: false });

const OrganizationProfileSchema = new Schema<IOrganizationProfile>({
    organizationCode: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
        maxlength: 50,
    },
    legalName: { type: String, required: true, trim: true, maxlength: 250 },
    displayName: { type: String, trim: true, maxlength: 150 },
    country: { type: String, required: true, trim: true, maxlength: 100, default: 'India' },
    corporateEmail: { type: String, trim: true, lowercase: true, maxlength: 250 },
    payrollEmail: { type: String, trim: true, lowercase: true, maxlength: 250 },
    phone: { type: String, trim: true, maxlength: 30 },
    website: { type: String, trim: true, maxlength: 500 },
    addresses: { type: [OrganizationAddressSchema], default: [] },
    statutoryRegistrations: { type: [StatutoryRegistrationSchema], default: [] },
    documentSettings: { type: DocumentSettingsSchema, default: undefined },
    status: {
        type: String,
        enum: ['Draft', 'Active', 'Inactive'],
        default: 'Draft',
        index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: true,
    optimisticConcurrency: true,
    versionKey: 'version',
});

OrganizationProfileSchema.pre('validate', function (next) {
    const primaryAddressTypes = this.addresses
        .filter((address) => address.isPrimary)
        .map((address) => address.type);

    if (new Set(primaryAddressTypes).size !== primaryAddressTypes.length) {
        this.invalidate('addresses', 'Only one primary address is allowed for each address type');
    }

    for (const registration of this.statutoryRegistrations) {
        if (
            registration.effectiveFrom &&
            registration.effectiveTo &&
            registration.effectiveTo < registration.effectiveFrom
        ) {
            this.invalidate(
                'statutoryRegistrations',
                `${registration.type} effectiveTo cannot be earlier than effectiveFrom`,
            );
        }

        if (
            registration.type === 'TAN' &&
            registration.isActive &&
            (!registration.authority?.name || !registration.authority?.address)
        ) {
            this.invalidate(
                'statutoryRegistrations',
                'Active TAN registration requires tax authority name and address',
            );
        }
    }

    next();
});

OrganizationProfileSchema.index({ 'statutoryRegistrations.registrationNumber': 1 });
OrganizationProfileSchema.index({ status: 1, country: 1 });

export const OrganizationProfile = model<IOrganizationProfile>(
    'OrganizationProfile',
    OrganizationProfileSchema,
    'organization_profiles',
);

