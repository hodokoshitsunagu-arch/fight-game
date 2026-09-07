import { assertProductionPackages } from './AdventurePackagePublication.js';

// Release packages are added here only after their reviewed text package has
// passed production validation. Development tracers never belong in this list.
export const PUBLISHED_ADVENTURE_PACKAGES = assertProductionPackages([]);
