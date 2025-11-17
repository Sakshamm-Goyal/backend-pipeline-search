import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import type { ConfigType } from '@nestjs/config';
import jwtConfig from '../../../../config/jwt.config';
import { JwtPayload } from '../../application/interfaces/jwt-payload.interface';
import { USER_REPOSITORY_TOKEN } from '../../../../shared/constants/tokens';
import { UserRepository } from '../../../user/infrastructure/persistence/repositories/user.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfiguration.accessSecret,
    });
  }

  async validate(payload: JwtPayload) {
    console.log('JWT Strategy - payload:', payload);
    const user = await this.userRepository.findById(payload.sub);
    console.log('JWT Strategy - found user:', user ? 'YES' : 'NO');
    if (!user) {
      return null;
    }
    // Add userId property to user object for controllers
    // Controllers expect req.user.userId but MongoDB schema has _id
    const userObj = user as any;
    userObj.userId = userObj._id?.toString() || payload.sub;
    console.log('JWT Strategy - user._id:', userObj._id, 'userId:', userObj.userId);
    return userObj;
  }
}
