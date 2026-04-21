import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/user.model';

dotenv.config();

// Set these two values before running the script
// `username` can be either the user's email or employee code.
const username = 'myhr@clouddesk.ae';
const password = 'NewPassword123';

const setPassword = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;
  console.log(mongoUri);
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required in environment variables');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  try {
    const user = await User.findOne({
      $or: [
        { email: username.toLowerCase().trim() },
        { employeeCode: username.trim() },
      ],
    }).select('+password');

    if (!user) {
      throw new Error(`No user found for username: ${username}`);
    }

    user.password = password;
    await user.save({ validateBeforeSave: false });

    console.log(`Password updated successfully for: ${user.email}`);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
};

setPassword()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to set password:', error);
    process.exit(1);
  });
