/**
 * "This day in history" — real events for today's date from Wikipedia, filtered
 * hard for kid-appropriateness and then ranked so inventions, space and firsts
 * float to the top.
 */

export interface HistoryFact {
  year: number
  text: string
}

const BAD =
  /war|battle|kill|dead|death|died|dies|murder|assassin|massacr|bomb|attack|execut|terror|hostage|slave|riot|shot|shoot|suicide|invad|invasion|genocide|hijack|crash|disaster|casualt|wounded|prison|lynch|abort|weapon|missile|conquer|siege|troops|army|rebellion|uprising|coup |sank|sinks|plague|epidemic|pandemic|fire destroys|hanged|beheaded/i

const GOOD =
  /first|invent|discover|patent|launch|space|astronaut|moon|planet|comet|telescope|opened|opens|founded|premiere|debut|olympic|world record|dinosaur|fossil|zoo|railway|railroad|bridge|museum|university|library|published|cartoon|television|telephone|radio|computer|airplane|flight|balloon|expedition|summit|national park|vaccine|element|bicycle|automobile|canal|lighthouse|observatory/i

interface WikiEvent {
  year: number
  text: string
}

export async function fetchHistory(date = new Date()): Promise<HistoryFact[]> {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  try {
    const res = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${mm}/${dd}`)
    if (!res.ok) return []
    const j = (await res.json()) as { selected?: WikiEvent[]; events?: WikiEvent[] }
    const seen = new Set<string>()

    return [...(j.selected ?? []), ...(j.events ?? [])]
      .filter((e) => e.year > 0 && e.text && !BAD.test(e.text) && !seen.has(e.text) && (seen.add(e.text), true))
      .map((e) => ({
        year: e.year,
        text: e.text.length > 200 ? `${e.text.slice(0, e.text.lastIndexOf(' ', 197))}…` : e.text,
        score: (GOOD.test(e.text) ? 2 : 0) + (e.text.length < 160 ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ year, text }) => ({ year, text }))
  } catch {
    return []
  }
}

const QUOTES: [string, string][] = [
  ["You're braver than you believe, and stronger than you seem.", 'A. A. Milne'],
  ['No act of kindness, no matter how small, is ever wasted.', 'Aesop'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['The more that you read, the more things you will know.', 'Dr. Seuss'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['Little by little, one travels far.', 'Proverb'],
  ['Mistakes are proof that you are trying.', 'Unknown'],
  ['A little progress each day adds up to big results.', 'Unknown'],
  ['Teamwork makes the dream work.', 'John C. Maxwell'],
]

/** Rotates once a week, same quote on every device. */
export function quoteOfTheWeek(now = Date.now()): { text: string; who: string } {
  const [text, who] = QUOTES[Math.floor(now / 6048e5) % QUOTES.length]
  return { text, who }
}
