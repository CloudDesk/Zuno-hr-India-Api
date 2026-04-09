import mongoose from 'mongoose';
import { config } from './index';

const DB_CONNECT_MAX_RETRIES = Math.max(
  1,
  Number(process.env.DB_CONNECT_MAX_RETRIES || 5),
);
const DB_CONNECT_RETRY_DELAY_MS = Math.max(
  1000,
  Number(process.env.DB_CONNECT_RETRY_DELAY_MS || 5000),
);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  if (mongoose.connection.readyState === 1) {
    return;
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= DB_CONNECT_MAX_RETRIES; attempt += 1) {
    try {
      console.log(
        `[DB] Connecting to MongoDB (attempt ${attempt}/${DB_CONNECT_MAX_RETRIES})...`,
      );
      await mongoose.connect(config.mongoUri);
      console.log('MongoDB connected successfully');

      await migrateEmailIndexIfNeeded();

      // Add event listeners for connection status once after a successful connect.
      if (attempt === 1 || mongoose.connection.listeners('error').length === 0) {
        mongoose.connection.on('error', (err) => {
          console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
          console.warn('MongoDB disconnected. Attempting to reconnect...');
        });

        mongoose.connection.on('reconnected', () => {
          console.log('MongoDB reconnected');
        });
      }

      return;
    } catch (error) {
      lastError = error;
      console.error(
        `[DB] MongoDB connection attempt ${attempt} failed:`,
        error,
      );

      if (attempt < DB_CONNECT_MAX_RETRIES) {
        console.warn(
          `[DB] Retrying MongoDB connection in ${DB_CONNECT_RETRY_DELAY_MS}ms...`,
        );
        await wait(DB_CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `[DB] Failed to connect to MongoDB after ${DB_CONNECT_MAX_RETRIES} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}; 
