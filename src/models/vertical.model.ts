import { Document, Schema, model } from 'mongoose';

export interface IVertical extends Document {
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const verticalSchema = new Schema<IVertical>(
  {
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
    collection: 'verticals',
  },
);

verticalSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: 'en', strength: 2 },
  },
);
verticalSchema.index({ isActive: 1, name: 1 });

export const Vertical = model<IVertical>('Vertical', verticalSchema);
