import { db } from './index'
// Compatibility entry point; db/index.ts runs the versioned schema migration.
export function seedDatabase() { db() }
seedDatabase()
