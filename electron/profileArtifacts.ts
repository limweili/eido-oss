const EIDO_PROFILE_DATABASE = /^eido-profile\.(?:db|sqlite3?)(?:-(?:wal|shm))?$/i

export function isEidoProfileDatabaseArtifact(relativePath: string): boolean {
  const basename = relativePath.split(/[\\/]/).at(-1)
  return basename !== undefined && EIDO_PROFILE_DATABASE.test(basename)
}
