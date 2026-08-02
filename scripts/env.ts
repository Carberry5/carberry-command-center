import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Loads .env.local (then .env) into process.env for the scripts in this folder.
 *
 * This exists for a reason worth writing down. Every script here needs
 * SUPABASE_SERVICE_ROLE_KEY, and several need an OAuth client secret on top.
 * Setting those by hand on each run means the values get copied between a
 * dashboard, a terminal and — sooner or later — a chat window or a shell
 * history file. That has already happened once on this project. A gitignored
 * file that is written once and read thereafter removes the step where a secret
 * has to pass through a human's clipboard.
 *
 * Import it for the side effect, before anything reads process.env:
 *
 *   import './env.ts'
 *
 * A real environment variable always wins, so CI — which injects secrets
 * directly and has no .env.local — behaves exactly as before.
 */

const QUOTED = /^(['"])(.*)\1$/s

function load(file: string): number {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8')
  } catch {
    return 0 // absent is the normal case in CI
  }

  let count = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // `export FOO=bar` is what people paste out of a terminal, so accept it.
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq < 1) continue

    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    // Already set — by CI, or by an export in this shell. Never override.
    if (process.env[key] !== undefined) continue

    let value = body.slice(eq + 1).trim()
    const quoted = QUOTED.exec(value)
    if (quoted) value = quoted[2]
    // Only strip a trailing comment from an unquoted value; a quoted one may
    // legitimately contain a #, and several kinds of key do.
    else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }

    process.env[key] = value
    count++
  }
  return count
}

const loaded = load('.env.local') + load('.env')

// Names only, never values — this line ends up in CI logs.
if (loaded && process.env.ENV_QUIET !== '1') {
  console.log(`(loaded ${loaded} value(s) from .env.local)`)
}

export {}
