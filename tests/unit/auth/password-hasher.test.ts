import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../../src/modules/auth/password-hasher.js';

// Deliberately cheap parameters: the test checks behaviour, not strength.
const hasher = new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1 });

describe('Argon2PasswordHasher', () => {
  it('produces a salted argon2id hash that verifies', async () => {
    const first = await hasher.hash('correct horse battery staple');
    const second = await hasher.hash('correct horse battery staple');

    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toBe(second);
    await expect(hasher.verify(first, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify(stored, 'Tr0ub4dor&3')).resolves.toBe(false);
  });

  it('treats a malformed hash as a mismatch', async () => {
    await expect(hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
