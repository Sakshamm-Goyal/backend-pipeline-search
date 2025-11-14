import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => {
  const accessSecret = process.env.JWT_ACCESS_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;

  // SECURITY FIX: Fail fast in production if secrets are not properly configured
  if (process.env.NODE_ENV === 'production') {
    if (!accessSecret || accessSecret.length < 32) {
      throw new Error(
        'SECURITY ERROR: JWT_ACCESS_SECRET must be set and at least 32 characters in production',
      );
    }
    if (!refreshSecret || refreshSecret.length < 32) {
      throw new Error(
        'SECURITY ERROR: JWT_REFRESH_SECRET must be set and at least 32 characters in production',
      );
    }
    // Ensure secrets are different
    if (accessSecret === refreshSecret) {
      throw new Error(
        'SECURITY ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
      );
    }
  }

  return {
    accessSecret: accessSecret || 'dev-access-secret-min-32-chars-long!!!',
    refreshSecret: refreshSecret || 'dev-refresh-secret-min-32-chars-long!!!',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  };
});
