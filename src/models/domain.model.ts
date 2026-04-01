import { Document, Schema, Types, model } from 'mongoose';

export interface IDomain extends Document {
  verticalId: Types.ObjectId;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const domainSchema = new Schema<IDomain>(
  {
    verticalId: {
      type: Schema.Types.ObjectId,
      ref: 'Vertical',
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'domains',
  },
);

domainSchema.index(
  { verticalId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: 'en', strength: 2 },
  },
);
domainSchema.index({ verticalId: 1, isActive: 1, name: 1 });

export const Domain = model<IDomain>('Domain', domainSchema);
