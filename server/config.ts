import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

/** Reads .env without pulling in a dependency. KEY=value, # comments, optional quotes. */
function loadDotEnv() {
  const file = resolve(process.cwd(), '.env')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadDotEnv()

const expandHome = (p: string) => (p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^[/\\]/, '')) : resolve(p))

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** Root of the Obsidian vault. */
  vaultPath: expandHome(process.env.VAULT_PATH ?? './vault'),
  /** Folder inside the vault that the app owns. */
  folder: process.env.VAULT_FOLDER ?? 'Family Council',
  /** `op://…` references for the wearable / banking integrations. */
  opRefs: {
    whoop: process.env.OP_WHOOP_REF ?? '',
    oura: process.env.OP_OURA_REF ?? '',
    greenlight: process.env.OP_GREENLIGHT_REF ?? '',
  } as Record<string, string>,
  /** Set by `npm start` to serve the built app from the sidecar too. */
  serveStatic: process.argv.includes('--serve-static'),
}

/** Absolute path to the app's folder inside the vault. */
export const vaultDir = resolve(config.vaultPath, config.folder)
