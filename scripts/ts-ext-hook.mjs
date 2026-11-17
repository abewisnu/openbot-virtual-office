// Resolve hook so Node's type stripping can follow the extensionless imports
// this project uses (`./constants`, `../types`). Only relative specifiers are
// touched, and only when the bare path really is missing.
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(new URL(specifier + ext, context.parentURL))) {
        return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}
