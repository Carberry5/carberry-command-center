import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Thin wrapper over the 1Password CLI. Values are read on demand and never
 * written to disk, logged, or held in the vault — only `op://` references are.
 */

/** `op://Vault/Item/field` (an optional section segment is allowed). */
const REF_RE = /^op:\/\/[^/\s]+\/[^/\s][^/]*\/[^/\s][^/]*(\/[^/\s][^/]*)?$/

export const isOpRef = (ref: string): boolean => REF_RE.test((ref ?? '').trim())

let cachedAvailable: boolean | null = null

export async function available(): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable
  try {
    await run('op', ['--version'], { timeout: 5000 })
    cachedAvailable = true
  } catch {
    cachedAvailable = false
  }
  return cachedAvailable
}

export class OpError extends Error {
  constructor(message: string, readonly code: 'no-cli' | 'bad-ref' | 'not-found' | 'locked') {
    super(message)
  }
}

/** Resolves a single reference to its secret value. */
export async function read(ref: string): Promise<string> {
  const clean = (ref ?? '').trim()
  if (!isOpRef(clean)) throw new OpError('Not a valid op:// reference', 'bad-ref')
  if (!(await available())) {
    throw new OpError('The 1Password CLI (`op`) is not installed or not on PATH', 'no-cli')
  }
  try {
    // execFile, not a shell — the reference is passed as a single argv entry.
    const { stdout } = await run('op', ['read', clean, '--no-newline'], { timeout: 20000 })
    return stdout
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '')
    if (/not signed in|authorization|session/i.test(msg)) {
      throw new OpError('1Password is locked — run `op signin` in a terminal', 'locked')
    }
    throw new OpError(`Could not read ${clean}`, 'not-found')
  }
}

/** True when the reference resolves, without ever returning the value. */
export async function check(ref: string): Promise<{ ok: boolean; reason?: string }> {
  if (!ref) return { ok: false, reason: 'No reference configured' }
  try {
    await read(ref)
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unavailable' }
  }
}
