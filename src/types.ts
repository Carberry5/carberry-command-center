/**
 * The family data model. Shared by the browser app and the vault sidecar —
 * the sidecar serialises exactly this shape to markdown and back.
 */

export type Role = 'parent' | 'kid'

/** A shortcut on a member's page — school portal, team site, reading log. */
export interface MemberLink {
  id: string
  label: string
  url: string
}

export interface Member {
  id: string
  name: string
  role: Role
  color: string
  age?: number
  /** Path under /assets, or a data URI. */
  photo?: string
  /** Places to check this member's progress: Schoology, Transparent Classroom… */
  links: MemberLink[]
}

export interface FamilyEvent {
  id: string
  title: string
  date: string
  /** "HH:MM", or null for an all-day event. */
  start: string | null
  /** Duration in minutes. */
  dur: number | null
  memberIds: string[]
  loc: string
  recur: 'weekly' | null
  /** Member id doing school drop-off. */
  drop?: string | null
  /** Member id doing pick-up. */
  pick?: string | null
}

/** An event resolved onto a particular day, with feed provenance attached. */
export interface ResolvedEvent extends FamilyEvent {
  /** Feed colour when the event came from an ICS feed. */
  feedColor: string | null
  /** Feed events are read-only — they're edited at the source calendar. */
  readOnly: boolean
}

export interface Chore {
  id: string
  title: string
  memberIds: string[]
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  stars: number
}

/** `done[YYYY-MM-DD]["<taskKey>|<memberId>"] = 1`. Task keys are chore ids or pre-flight keys. */
export type DoneMap = Record<string, Record<string, 1>>

export interface Reward {
  id: string
  title: string
  cost: number
}

export interface Redemption {
  id: string
  kidId: string
  title: string
  cost: number
  ts: number
}

export interface Favorite {
  id: string
  name: string
  tag?: string
}

export interface ListItem {
  id: string
  text: string
  done: boolean
  /** Member id who added it. */
  by: string
  /**
   * Where it came from. Absent means somebody typed it in the app; 'reminders'
   * means it arrived from an iCloud Reminders list, and the ingest job owns it
   * — the next post removes it if it has gone from the phone's list.
   */
  src?: string
  /** Its id in the system it syncs with — a Google Tasks task id. */
  rid?: string
}

export interface FamilyList {
  id: string
  name: string
  items: ListItem[]
}

export interface Countdown {
  id: string
  title: string
  date: string
  memberId: string | null
}

export interface Feed {
  id: string
  name: string
  /** Direct ICS url. Empty when the url lives in 1Password instead. */
  url: string
  /** `op://Vault/Item/field` reference resolved by the sidecar. */
  opRef?: string
  color: string
  status: string
  /**
   * Members these events belong to. Empty means the whole family — a school
   * calendar covering two kids is tagged with both, so it lands on their pages
   * and not on their siblings'.
   */
  memberIds: string[]
}

export interface Settings {
  pin: string
  zip: string
  lat: number
  lon: number
  place: string
  feeds: Feed[]
}

export interface BringItem {
  id: string
  text: string
  days: number[]
}

export interface PreflightKid {
  /** Weekdays (1–5) the kid wears the gym uniform. */
  gym: number[]
  /** Weekdays (1–5) lunch is packed rather than bought. */
  lun: number[]
  bring: BringItem[]
}

export interface Preflight {
  open: boolean
  /** "HH:MM" the car leaves. */
  depart?: string
  kids: Record<string, PreflightKid>
}

export interface WhoopStats {
  kind: 'whoop'
  sleep: number
  strain: number
}

export interface OuraStats {
  kind: 'oura'
  sleep: number
  act: number
}

export type FitStats = WhoopStats | OuraStats

export interface GreenlightPayout {
  d: string
  for: string
  amt: number
}

export interface Greenlight {
  bal: number
  allow: number
  goal: string
  goalCost: number
  saved: number
  pay: GreenlightPayout[]
}

/** A secret the app displays but never stores — resolved from 1Password on demand. */
export interface SecretRef {
  id: string
  label: string
  /** `op://Vault/Item/field`. */
  ref: string
  note?: string
}

export interface FamilyData {
  members: Member[]
  events: FamilyEvent[]
  chores: Chore[]
  done: DoneMap
  rewards: Reward[]
  redemptions: Redemption[]
  favorites: Favorite[]
  /** `mealPlan[YYYY-MM-DD] = "Taco night"` */
  mealPlan: Record<string, string>
  lists: FamilyList[]
  countdowns: Countdown[]
  settings: Settings
  /** Events pulled from ICS feeds, keyed by feed id. Cache only — not mirrored to the vault. */
  feedEv: Record<string, FamilyEvent[]>
  preflight: Preflight
  /** Wearable stats keyed by member id. */
  fit: Record<string, FitStats>
  /** Greenlight cards keyed by kid id. */
  gl: Record<string, Greenlight>
  secrets: SecretRef[]
}

export type PageId =
  | 'today'
  | 'member'
  | 'calendar'
  | 'chores'
  | 'meals'
  | 'lists'
  | 'countdowns'
  | 'sidekick'
  | 'settings'

/** Payload the sidecar pushes on every change. */
export interface SyncEnvelope {
  rev: number
  data: FamilyData
}
