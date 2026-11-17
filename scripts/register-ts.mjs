// Registers the extensionless-import hook before a verify script runs.
// Usage: node --import ./scripts/register-ts.mjs scripts/verify-chairs.mjs
import { register } from 'node:module';

register('./ts-ext-hook.mjs', import.meta.url);
