import { registerAs } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';

/**
 * Read Apple private key from file if path is provided and valid
 */
const getApplePrivateKey = (): string | undefined => {
  const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;

  // Skip if not configured or is example placeholder
  if (!keyPath || keyPath.includes('path/to/AuthKey')) {
    return undefined;
  }

  // Check if file exists before trying to read
  if (!existsSync(keyPath)) {
    console.warn(`⚠️  Apple OAuth: Private key file not found at ${keyPath}`);
    return undefined;
  }

  try {
    return readFileSync(keyPath, 'utf8');
  } catch (error) {
    console.error(`❌ Apple OAuth: Failed to read private key:`, error);
    return undefined;
  }
};

export default registerAs('oauth', () => ({
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback',
  },
  apple: {
    clientID: process.env.APPLE_CLIENT_ID,
    teamID: process.env.APPLE_TEAM_ID,
    keyID: process.env.APPLE_KEY_ID,
    privateKey: getApplePrivateKey(),
    callbackURL: process.env.APPLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/apple/callback',
  },
}));
