import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { USER_REPOSITORY_TOKEN } from '../../../../shared/constants/tokens';
import { UserRepository } from '../../../user/infrastructure/persistence/repositories/user.repository';
import { AuthProvider } from '../../domain/enums/auth-provider.enum';
import { User } from '../../../user/domain/schemas/user.schema';
import { EncryptionService } from '../../../../shared/services/encryption.service';

export interface OAuthProfile {
  provider: AuthProvider;
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  accessToken?: string;
  refreshToken?: string;
}

@Injectable()
export class OAuthService {
  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepository,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Find or create user from OAuth profile
   */
  async validateOAuthUser(profile: OAuthProfile): Promise<User> {
    // Check if user exists with this OAuth provider
    let user = await this.userRepository.findByOAuthProvider(
      profile.provider,
      profile.providerId,
    );

    if (user) {
      // Update OAuth provider data
      await this.updateOAuthProvider(user, profile);
      return user;
    }

    // Check if user exists with this email
    user = await this.userRepository.findByEmail(profile.email);

    if (user) {
      // Link OAuth account to existing user
      await this.linkOAuthAccount(user, profile);
      return user;
    }

    // Create new user
    return this.createOAuthUser(profile);
  }

  /**
   * Create new user from OAuth profile
   */
  private async createOAuthUser(profile: OAuthProfile): Promise<User> {
    // SECURITY: Encrypt OAuth tokens before storing
    const encryptedAccessToken = profile.accessToken
      ? await this.encryptionService.encrypt(profile.accessToken)
      : undefined;
    const encryptedRefreshToken = profile.refreshToken
      ? await this.encryptionService.encrypt(profile.refreshToken)
      : undefined;

    return this.userRepository.create({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      emailVerified: true, // OAuth providers verify emails
      providers: [
        {
          provider: profile.provider,
          providerId: profile.providerId,
          email: profile.email,
          displayName: `${profile.firstName} ${profile.lastName}`,
          accessToken: encryptedAccessToken ? { token: encryptedAccessToken } : undefined,
          refreshToken: encryptedRefreshToken,
          linkedAt: new Date(),
        },
      ],
    } as any);
  }

  /**
   * Link OAuth account to existing user
   */
  private async linkOAuthAccount(user: User, profile: OAuthProfile): Promise<User> {
    // SECURITY: Encrypt OAuth tokens before storing
    const encryptedAccessToken = profile.accessToken
      ? await this.encryptionService.encrypt(profile.accessToken)
      : undefined;
    const encryptedRefreshToken = profile.refreshToken
      ? await this.encryptionService.encrypt(profile.refreshToken)
      : undefined;

    const providerData = {
      provider: profile.provider,
      providerId: profile.providerId,
      email: profile.email,
      displayName: `${profile.firstName} ${profile.lastName}`,
      accessToken: encryptedAccessToken ? { token: encryptedAccessToken } : undefined,
      refreshToken: encryptedRefreshToken,
      linkedAt: new Date(),
    };

    user.providers.push(providerData as any);
    await user.save();
    return user;
  }

  /**
   * Update OAuth provider data
   */
  private async updateOAuthProvider(user: User, profile: OAuthProfile): Promise<User> {
    const providerIndex = user.providers.findIndex(
      (p) => p.provider === profile.provider && p.providerId === profile.providerId,
    );

    if (providerIndex >= 0) {
      // SECURITY: Encrypt OAuth tokens before storing
      const encryptedAccessToken = profile.accessToken
        ? await this.encryptionService.encrypt(profile.accessToken)
        : undefined;
      const encryptedRefreshToken = profile.refreshToken
        ? await this.encryptionService.encrypt(profile.refreshToken)
        : undefined;

      user.providers[providerIndex] = {
        ...user.providers[providerIndex],
        accessToken: encryptedAccessToken ? { token: encryptedAccessToken } : undefined,
        refreshToken: encryptedRefreshToken,
      } as any;

      await user.save();
    }

    return user;
  }

  /**
   * Unlink OAuth provider
   */
  async unlinkProvider(userId: string, provider: AuthProvider): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Don't allow unlinking if it's the only auth method and no password
    if (user.providers.length === 1 && !user.password) {
      throw new BadRequestException('Cannot unlink the only authentication method');
    }

    user.providers = user.providers.filter((p) => p.provider !== provider) as any;
    await user.save();
  }
}
