import { Document, Schema, Types, model } from 'mongoose';
import { normalizeAliases, normalizeSkillKey, trimString } from '../utilis/skill-normalization';

export interface ISkill extends Document {
  domainId: Types.ObjectId;
  name: string;
  description?: string;
  aliases: string[];
  normalizedKey: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const skillSchema = new Schema<ISkill>(
  {
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    aliases: {
      type: [String],
      default: [],
    },
    normalizedKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'skills',
  },
);

skillSchema.pre('validate', function normalizeSkillData(next) {
  this.name = this.name?.trim();

  const normalizedKeySource = trimString(this.normalizedKey) || this.name;
  this.normalizedKey = normalizeSkillKey(normalizedKeySource || '');

  this.aliases = normalizeAliases((this.aliases || []).map((alias) => String(alias)));
  next();
});

skillSchema.index(
  { domainId: 1, normalizedKey: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
  },
);
skillSchema.index({ domainId: 1, isActive: 1, name: 1 });
skillSchema.index({ normalizedKey: 1 });

export const Skill = model<ISkill>('Skill', skillSchema);
