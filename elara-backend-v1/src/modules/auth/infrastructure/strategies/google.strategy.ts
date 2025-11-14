import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { ConfigType } from '@nestjs/config';
import oauthConfig from '../../../../config/oauth.config';
import { AuthService } from '../../application/services/auth.service';
import { AuthProvider } from '../../domain/enums/auth-provider.enum';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    @Inject(oauthConfig.KEY)
    private readonly oauthConfiguration: ConfigType<typeof oauthConfig>,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: oauthConfiguration.google.clientID,
      clientSecret: oauthConfiguration.google.clientSecret,
      callbackURL: oauthConfiguration.google.callbackURL,
      scope: ['email', 'profile'],
    } as any);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails } = profile;

    const oauthProfile = {
      provider: AuthProvider.GOOGLE,
      providerId: id,
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      accessToken,
      refreshToken,
    };

    const user = await this.authService.validateOAuthUser(oauthProfile);
    done(null, user);
  }
}
