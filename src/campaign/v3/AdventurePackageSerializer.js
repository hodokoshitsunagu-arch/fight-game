function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export function exportAdventurePackage(adventurePackage) {
  const forbidden = validateAdventurePackageDetailed(adventurePackage, { level: 'development' })
    .filter((item) => item.code === 'street-view.forbidden-field');
  if (forbidden.length) throw new Error(forbidden.map((item) => item.message).join('; '));
  return `${JSON.stringify(sortValue(adventurePackage), null, 2)}\n`;
}

export function importAdventurePackage(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Package text is not valid JSON: ${error.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Package text must contain one adventure package object');
  }
  return sortValue(parsed);
}
import { validateAdventurePackageDetailed } from './AdventurePackageValidator.js';
