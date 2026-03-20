import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolvePackageVersion() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(currentDir, '../package.json');

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };

    return packageJson.version?.trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const DEFAULT_APP_VERSION = resolvePackageVersion();
