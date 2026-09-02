import { Schema, model, Document, Types } from 'mongoose';

export const EMPLOYEE_LIST_COLUMN_KEYS = [
  'name',
  'role',
  'licenseType',
  'country',
  'departmentId',
  'isActive',
  'portalAccess',
  'employeeCode',
  'specificRole',
  'managerName',
  'joiningDate',
  'employmentStatus',
  'costCenter',
  'location',
  'phone',
  'gender',
  '_id',
] as const;

export type EmployeeListColumnKey = typeof EMPLOYEE_LIST_COLUMN_KEYS[number];

export interface IEmployeeListPreference extends Document {
  scope: 'organization';
  columns: EmployeeListColumnKey[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const employeeListPreferenceSchema = new Schema<IEmployeeListPreference>(
  {
    scope: { type: String, enum: ['organization'], default: 'organization', unique: true },
    columns: [{ type: String, enum: EMPLOYEE_LIST_COLUMN_KEYS, required: true }],
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const EmployeeListPreference = model<IEmployeeListPreference>(
  'EmployeeListPreference',
  employeeListPreferenceSchema,
);
