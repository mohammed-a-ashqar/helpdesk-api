import { readFileSync } from 'node:fs';

/** Version from package.json (resolved relative to both src/ and dist/). */
export const APP_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
