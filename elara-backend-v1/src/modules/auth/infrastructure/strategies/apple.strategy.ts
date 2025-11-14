import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-apple';
import type { ConfigType } from '@nestjs/config';
import oauthConfig from '../../../../config/oauth.config';
import { AuthService } from '../../application/services/auth.service';
import { AuthProvider } from '../../domain/enums/auth-provider.enum';

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(
    @Inject(oauthConfig.KEY)
    private readonly oauthConfiguration: ConfigType<typeof oauthConfig>,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: oauthConfiguration.apple.clientID || '',
      teamID: oauthConfiguration.apple.teamID || '',
      keyID: oauthConfiguration.apple.keyID || '',
      privateKeyString: oauthConfiguration.apple.privateKey,
      callbackURL: oauthConfiguration.apple.callbackURL || '',
      scope: ['email', 'name'],
      passReqToCallback: false,
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    idToken: any,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails } = profile;
    const email = emails?.[0]?.value || '';

    const oauthProfile = {
      provider: AuthProvider.APPLE,
      providerId: id,
      email: email,
      firstName: name?.firstName || 'Apple',
      lastName: name?.lastName || 'User',
      accessToken,
      refreshToken,
    };

    const user = await this.authService.validateOAuthUser(oauthProfile);
    done(null, user);
  }
}
