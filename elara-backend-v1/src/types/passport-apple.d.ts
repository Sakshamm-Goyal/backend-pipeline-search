declare module 'passport-apple' {
  import { Request } from 'express';
  import { Strategy as PassportStrategy } from 'passport-strategy';

  export interface Profile {
    id: string;
    provider: string;
    displayName?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
    emails?: Array<{ value: string; verified?: boolean }>;
    _raw?: string;
    _json?: any;
  }

  export type VerifyCallback = (
    err?: Error | null,
    user?: any,
    info?: any,
  ) => void;

  export interface StrategyOptions {
    clientID: string;
    teamID: string;
    keyID: string;
    privateKeyString?: string;
    privateKeyLocation?: string;
    callbackURL: string;
    passReqToCallback?: boolean;
    scope?: string[];
  }

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void;

  export type VerifyFunctionWithRequest = (
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) => void;

  export class Strategy extends PassportStrategy {
    constructor(
      options: StrategyOptions,
      verify: VerifyFunction | VerifyFunctionWithRequest,
    );
    name: string;
    authenticate(req: Request, options?: any): void;
  }
}
