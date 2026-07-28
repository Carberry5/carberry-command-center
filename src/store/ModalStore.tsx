import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Reward, ResolvedEvent } from '../types.ts'
import { today } from '../lib/dates.ts'
import { useFamily } from './FamilyStore.tsx'

/** Draft state for every dialog. One slot per dialog, exactly as the design had. */

export interface EventDraft {
  id?: string
  t: string
  date: string
  start: string
  dur: string
  loc: string
  mems: string[]
  rec: boolean
  drop: string
  pick: string
}

export interface ChoreDraft {
  id?: string
  t: string
  mems: string[]
  days: number[]
  stars: number
}

export interface RewardDraft {
  id?: string
  t: string
  cost: number
}

export interface IntegrationDraft {
  type: 'gl' | 'whoop' | 'oura'
  mem: string
  vals: Record<string, string | number>
}

export interface CountdownDraft {
  id?: string
  t: string
  date: string
  mem: string | null
}

export interface VoiceState {
  status: string
  text: string
  reply: string | null
}

interface ModalValue {
  event: EventDraft | null
  setEvent: (v: EventDraft | null | ((prev: EventDraft) => EventDraft)) => void
  newEvent: (date?: string) => void
  editEvent: (e: ResolvedEvent) => void

  chore: ChoreDraft | null
  setChore: (v: ChoreDraft | null | ((prev: ChoreDraft) => ChoreDraft)) => void

  reward: RewardDraft | null
  setReward: (v: RewardDraft | null | ((prev: RewardDraft) => RewardDraft)) => void

  redeem: Reward | null
  setRedeem: (v: Reward | null) => void

  /** Date whose dinner is being picked. */
  mealPick: string | null
  setMealPick: (v: string | null) => void
  mealQuery: string
  setMealQuery: (v: string) => void

  /** Favourite meal being assigned to a night. */
  planNight: string | null
  setPlanNight: (v: string | null) => void

  countdown: CountdownDraft | null
  setCountdown: (v: CountdownDraft | null | ((prev: CountdownDraft) => CountdownDraft)) => void

  integration: IntegrationDraft | null
  setIntegration: (v: IntegrationDraft | null | ((prev: IntegrationDraft) => IntegrationDraft)) => void

  /** Date whose events are shown in the month-view day sheet. */
  dayDetail: string | null
  setDayDetail: (v: string | null) => void

  voice: VoiceState | null
  setVoice: (v: VoiceState | null | ((prev: VoiceState) => VoiceState)) => void
}

const Ctx = createContext<ModalValue | null>(null)

/** Lets a setter take either a value or an updater, like useState. */
function slot<T>(value: T | null, set: (v: T | null) => void) {
  return (next: T | null | ((prev: T) => T)) => {
    if (typeof next === 'function') {
      if (value === null) return
      set((next as (prev: T) => T)(value))
    } else set(next)
  }
}

export function ModalStoreProvider({ children }: { children: ReactNode }) {
  const { toast } = useFamily()
  const [event, setEventRaw] = useState<EventDraft | null>(null)
  const [chore, setChoreRaw] = useState<ChoreDraft | null>(null)
  const [reward, setRewardRaw] = useState<RewardDraft | null>(null)
  const [redeem, setRedeem] = useState<Reward | null>(null)
  const [mealPick, setMealPick] = useState<string | null>(null)
  const [mealQuery, setMealQuery] = useState('')
  const [planNight, setPlanNight] = useState<string | null>(null)
  const [countdown, setCountdownRaw] = useState<CountdownDraft | null>(null)
  const [integration, setIntegrationRaw] = useState<IntegrationDraft | null>(null)
  const [dayDetail, setDayDetail] = useState<string | null>(null)
  const [voice, setVoiceRaw] = useState<VoiceState | null>(null)

  const newEvent = useCallback((date?: string) => {
    setEventRaw({ t: '', date: date ?? today(), start: '', dur: '', loc: '', mems: [], rec: false, drop: '', pick: '' })
  }, [])

  const editEvent = useCallback(
    (e: ResolvedEvent) => {
      if (e.readOnly) {
        toast('From a synced feed — edit it at the source calendar')
        return
      }
      setEventRaw({
        id: e.id,
        t: e.title,
        date: e.date,
        start: e.start ?? '',
        dur: e.dur ? String(e.dur) : '',
        loc: e.loc ?? '',
        mems: [...(e.memberIds ?? [])],
        rec: e.recur === 'weekly',
        drop: e.drop ?? '',
        pick: e.pick ?? '',
      })
    },
    [toast]
  )

  const value = useMemo<ModalValue>(
    () => ({
      event,
      setEvent: slot(event, setEventRaw),
      newEvent,
      editEvent,
      chore,
      setChore: slot(chore, setChoreRaw),
      reward,
      setReward: slot(reward, setRewardRaw),
      redeem,
      setRedeem,
      mealPick,
      setMealPick,
      mealQuery,
      setMealQuery,
      planNight,
      setPlanNight,
      countdown,
      setCountdown: slot(countdown, setCountdownRaw),
      integration,
      setIntegration: slot(integration, setIntegrationRaw),
      dayDetail,
      setDayDetail,
      voice,
      setVoice: slot(voice, setVoiceRaw),
    }),
    [event, chore, reward, redeem, mealPick, mealQuery, planNight, countdown, integration, dayDetail, voice, newEvent, editEvent]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useModals(): ModalValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useModals must be used inside <ModalStoreProvider>')
  return ctx
}
