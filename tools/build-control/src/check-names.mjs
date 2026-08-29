/**
 * The stable check-run names the branch ruleset would require. Side-effect
 * free so tests can import them without running a CLI: a rename here has to
 * show up in the workflow structural test rather than silently detach a
 * required check from the thing that writes it.
 */
export const ADMISSION_CHECK_NAME = 'Build Control Admission'
export const MERGE_AUTH_CHECK_NAME = 'Build Control Merge Authorisation'
