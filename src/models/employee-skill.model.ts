import { Document, Schema, Types, model } from 'mongoose';

export interface IEmployeeSkill extends Document {
  employeeId: Types.ObjectId;
  skillId: Types.ObjectId;
  proficiencyLevel: number;
  yearsExperience: number;
  lastUsedOn?: Date;
  isCertified: boolean;
  certificationName?: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const employeeSkillSchema = new Schema<IEmployeeSkill>(
  {
    employeeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    skillId: {
      type: Schema.Types.ObjectId,
      ref: 'Skill',
      required: true,
      index: true,
    },
    proficiencyLevel: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    yearsExperience: {
      type: Number,
      required: true,
      min: 0,
    },
    lastUsedOn: {
      type: Date,
    },
    isCertified: {
      type: Boolean,
      default: false,
    },
    certificationName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    remarks: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
    collection: 'employeeSkills',
  },
);

employeeSkillSchema.index({ employeeId: 1, skillId: 1 }, { unique: true });
employeeSkillSchema.index({ employeeId: 1, proficiencyLevel: 1 });
employeeSkillSchema.index({ skillId: 1, isCertified: 1 });

export const EmployeeSkill = model<IEmployeeSkill>(
  'EmployeeSkill',
  employeeSkillSchema,
);
