import { hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface Argon2Options {
  /** Memory per hash in KiB (OWASP baseline: 19456 = 19 MiB). */
  memoryCost: number;
  /** Number of passes (OWASP baseline: 2). */
  timeCost: number;
}

/** Argon2id hashing (the library default variant), parameters from config. */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly options: Argon2Options) {}

  hash(password: string): Promise<string> {
    return hash(password, { ...this.options, parallelism: 1 });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // Malformed hash: treat as a failed match rather than a server error.
      return false;
    }
  }
}
