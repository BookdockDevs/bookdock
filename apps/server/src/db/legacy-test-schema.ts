// Historical upgrade fixtures deliberately retain the pre-retirement tables.
export * from './schema'
export * from './legacy-book-schema'
export { users, instanceSettings } from './legacy-identity-schema'
