import { validateAdventurePackageDetailed } from './AdventurePackageValidator.js';

export function assertProductionPackages(packages) {
  for (const adventurePackage of packages) {
    const diagnostics = validateAdventurePackageDetailed(adventurePackage, { level: 'production' });
    if (diagnostics.length) {
      const details = diagnostics
        .map((item) => `${item.code} at ${item.path}: ${item.message}`)
        .join('\n');
      throw new Error(`Package ${adventurePackage?.id ?? '<unknown>'} is not production validated:\n${details}`);
    }
  }
  return packages;
}
