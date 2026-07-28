import type { FamilyData, PageId } from '../types.ts'
import { addDays, today, uid } from './dates.ts'
import { balances } from './selectors.ts'

/**
 * Browser voice control. Chrome and Edge only (Safari has no SpeechRecognition),
 * and it needs https or localhost for the mic prompt — the sidecar's LAN address
 * counts as neither, so on the iPad this falls back to a friendly explanation.
 */

interface SpeechRecognitionAlternative {
  transcript: string
}
interface SpeechRecognitionResult {
  isFinal: boolean
  0: SpeechRecognitionAlternative
}
interface SpeechRecognitionEvent {
  results: ArrayLike<SpeechRecognitionResult> & Iterable<SpeechRecognitionResult>
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  start(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface VoiceHost {
  data: FamilyData
  update: (fn: (draft: FamilyData) => void) => void
  go: (page: PageId) => void
}

interface VoiceUi {
  setVoice: (v: { status: string; text: string; reply: string | null } | null) => void
}

let active: SpeechRecognitionLike | null = null

export function abortVoice() {
  try {
    active?.abort()
  } catch {
    /* already stopped */
  }
  active = null
}

export function startVoice(host: VoiceHost, ui: VoiceUi) {
  const Ctor = (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
  const SR = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition
  if (!SR) {
    ui.setVoice({
      status: 'Voice needs Chrome or Edge',
      text: '',
      reply: 'This browser has no speech recognition. Try the Sidekick instead!',
    })
    return
  }

  ui.setVoice({ status: 'Listening…', text: '', reply: null })
  const recognition = new SR()
  active = recognition
  recognition.lang = 'en-US'
  recognition.interimResults = true

  recognition.onresult = (event) => {
    let final = ''
    let interim = ''
    for (const result of event.results) {
      if (result.isFinal) final += result[0].transcript
      else interim += result[0].transcript
    }
    if (interim) ui.setVoice({ status: 'Listening…', text: interim, reply: null })
    if (final) {
      ui.setVoice({ status: 'Listening…', text: final, reply: null })
      handleCommand(final.trim(), host, ui)
    }
  }

  recognition.onerror = (e) => {
    ui.setVoice({
      status: 'Hmm, no luck',
      text: '',
      reply:
        e.error === 'not-allowed'
          ? 'Microphone permission was blocked.'
          : 'Could not hear you — try again!',
    })
  }

  try {
    recognition.start()
  } catch {
    /* start() throws if it's already running */
  }
}

function speak(text: string) {
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  } catch {
    /* no speech synthesis — the on-screen reply is enough */
  }
}

/** Parses and runs one spoken command. Exported so it can be unit-tested. */
export function handleCommand(raw: string, host: VoiceHost, ui: VoiceUi) {
  const t = raw.toLowerCase().replace(/[.!?]$/, '')
  const { data } = host
  const say = (reply: string) => {
    ui.setVoice({ status: 'Got it!', text: `“${raw}”`, reply })
    speak(reply)
  }

  // "Add milk to the grocery list"
  let m = t.match(/add (.+?) to (?:the |my |our )?(.+?)(?: list)?$/)
  if (m) {
    const [, item, listName] = m
    const list = data.lists.find(
      (l) => l.name.toLowerCase().includes(listName) || listName.includes(l.name.toLowerCase().split(' ')[0])
    )
    if (list) {
      const text = item.charAt(0).toUpperCase() + item.slice(1)
      host.update((d) => {
        d.lists.find((l) => l.id === list.id)?.items.push({ id: uid(), text, done: false, by: 'e' })
      })
      say(`Added ${text} to ${list.name}.`)
      return
    }
  }

  // "What's for dinner?" / "What's for dinner tomorrow?"
  if (/dinner/.test(t)) {
    const ds = /tomorrow/.test(t) ? addDays(today(), 1) : today()
    const meal = data.mealPlan[ds]
    say(
      meal
        ? `${/tomorrow/.test(t) ? 'Tomorrow' : 'Tonight'} it's ${meal}!`
        : 'Nothing planned yet — want to pick something on the Meals page?'
    )
    return
  }

  // "Go to the calendar"
  m = t.match(/(?:go to|show|open) (?:the )?(today|home|calendar|chores|meals|lists|countdowns|sidekick|settings)/)
  if (m) {
    const page = (m[1] === 'home' ? 'today' : m[1]) as PageId
    ui.setVoice(null)
    host.go(page)
    return
  }

  // "Cannon did brush teeth"
  m = t.match(/(\w+) (?:did|finished|completed) (?:the |his |her |their )?(.+)/)
  if (m) {
    const kid = data.members.find((mm) => mm.name.toLowerCase() === m![1])
    const chore = data.chores.find(
      (c) => c.title.toLowerCase().includes(m![2]) || m![2].includes(c.title.toLowerCase().split(' ')[0])
    )
    if (kid && chore) {
      const td = today()
      host.update((d) => {
        d.done[td] = d.done[td] ?? {}
        d.done[td][`${chore.id}|${kid.id}`] = 1
      })
      say(`Nice work, ${kid.name}! ${chore.title} is checked off — plus ${chore.stars} ${chore.stars > 1 ? 'stars.' : 'star.'}`)
      return
    }
  }

  // "How many stars does Hadley have?"
  m = t.match(/how many stars (?:does |has )?(\w+)/)
  if (m) {
    const kid = data.members.find((mm) => mm.name.toLowerCase() === m![1])
    if (kid) {
      say(`${kid.name} has ${balances(data)[kid.id] ?? 0} stars.`)
      return
    }
  }

  say("I didn't catch that one. Try “Add milk to the grocery list” or “What's for dinner?”")
}
