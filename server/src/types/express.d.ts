// Module augmentation for Express's Request type.
//
// Express doesn't know about the custom properties that refreshTokenMiddleware
// attaches to each request. Without this declaration TypeScript would reject
// reads like `req.accessToken` — forcing every route handler to write the
// unsafe cast `(req as any).accessToken`.
//
// Declaring them here once gives full type safety everywhere: a typo like
// `req.acceesToken` becomes a compile error rather than a silent undefined.
//
// This is the standard TypeScript pattern for augmenting third-party types:
// declare a module that matches the package name, then add your fields inside
// the existing interface. TypeScript merges the two declarations automatically.

// This empty export makes TypeScript treat this file as an ES module rather than a
// global script. That distinction matters: `declare module` inside a global script
// creates a brand-new ambient module (shadowing Express's real types entirely),
// while `declare module` inside a module file *augments* the existing one.
export {};

// Express v5 stores the Request type in express-serve-static-core, not in the
// global Express namespace. Augmenting this module is the correct way to add
// custom properties to req in Express v5 + @types/express v5.
declare module 'express-serve-static-core' {
  interface Request {
    // Set by refreshTokenMiddleware — always a valid, non-expired access token
    // for the platform the current user authenticated with.
    accessToken: string;

    // Set by refreshTokenMiddleware — identifies which streaming platform this
    // user belongs to ('SPOTIFY' | 'SOUNDCLOUD' | 'TIDAL').
    userPlatform: string;
  }
}
