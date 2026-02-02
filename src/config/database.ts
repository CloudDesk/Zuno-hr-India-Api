import mongoose from 'mongoose';
import { config } from './index';

/**
 * One-time migration: drop old global unique index on users.email so duplicate email
 * (allowDuplicateEmail) can work. Only drops the index; no user data is deleted.
 * Safe to run on live DB: existing documents are unchanged.
 */
async function migrateEmailIndexIfNeeded(): Promise<void> {
  try {
    const coll = mongoose.connection.collection('users');
    const indexes = await coll.indexes();
    const emailIndex = (indexes as { name: string }[]).find((i) => i.name === 'email_1');
    if (!emailIndex) return;
    // Drop only the old global unique index; partial index is created by User model
    await coll.dropIndex('email_1');
    console.log('[DB] Dropped old email_1 index; app will use partial unique index (portalAccess: true). No data removed.');
  } catch (err: any) {
    if (err.codeName === 'IndexNotFound' || err.message?.includes('index not found')) return;
    console.warn('[DB] migrateEmailIndexIfNeeded:', err.message);
  }
}

export const connectDB = async (): Promise<void> => {
  try {
    console.log('Connecting to MongoDB...', config);
    await mongoose.connect(config.mongoUri);
    console.log('MongoDB connected successfully');

    await migrateEmailIndexIfNeeded();

    // Add event listeners for connection status
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}; 