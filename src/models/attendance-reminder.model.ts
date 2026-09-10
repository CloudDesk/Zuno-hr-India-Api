import { Schema, model, Document, Types } from 'mongoose';

export interface IAttendanceReminder extends Document {
  attendanceRecordId: Types.ObjectId;
  userId: Types.ObjectId;
  reminderType: 'missing_checkout';
  attendanceDate: string;
  status: 'processing' | 'sent' | 'failed';
  pushSent: boolean;
  emailSent: boolean;
  error?: string;
  sentAt?: Date;
}

const attendanceReminderSchema = new Schema<IAttendanceReminder>(
  {
    attendanceRecordId: {
      type: Schema.Types.ObjectId,
      ref: 'AttendanceRecord',
      required: true
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reminderType: {
      type: String,
      enum: ['missing_checkout'],
      required: true
    },
    attendanceDate: { type: String, required: true },
    status: {
      type: String,
      enum: ['processing', 'sent', 'failed'],
      default: 'processing'
    },
    pushSent: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    error: { type: String },
    sentAt: { type: Date }
  },
  { timestamps: true }
);

attendanceReminderSchema.index(
  { attendanceRecordId: 1, reminderType: 1 },
  { unique: true }
);

export const AttendanceReminder = model<IAttendanceReminder>(
  'AttendanceReminder',
  attendanceReminderSchema
);
