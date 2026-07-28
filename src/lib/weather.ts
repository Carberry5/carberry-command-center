/** Open-Meteo: no key, no account, and it allows browser requests. */

export interface HourWx {
  t: number
  c: number
}
export interface DayWx {
  hi: number
  lo: number
  c: number
}
export interface Weather {
  cur: HourWx
  /** Keyed by "YYYY-MM-DDTHH". */
  hr: Record<string, HourWx>
  /** Keyed by "YYYY-MM-DD". */
  dy: Record<string, DayWx>
}

interface ForecastResponse {
  current: { temperature_2m: number; weather_code: number }
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[] }
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] }
}

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=8'
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const j = (await res.json()) as ForecastResponse

    const hr: Record<string, HourWx> = {}
    j.hourly.time.forEach((t, i) => {
      hr[t.slice(0, 13)] = { t: Math.round(j.hourly.temperature_2m[i]), c: j.hourly.weather_code[i] }
    })
    const dy: Record<string, DayWx> = {}
    j.daily.time.forEach((t, i) => {
      dy[t] = {
        hi: Math.round(j.daily.temperature_2m_max[i]),
        lo: Math.round(j.daily.temperature_2m_min[i]),
        c: j.daily.weather_code[i],
      }
    })
    return { cur: { t: Math.round(j.current.temperature_2m), c: j.current.weather_code }, hr, dy }
  } catch {
    return null
  }
}

export interface GeocodeResult {
  lat: number
  lon: number
  place: string
  name: string
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim()
  if (!q) return null
  const url =
    'https://geocoding-api.open-meteo.com/v1/search' +
    `?name=${encodeURIComponent(q)}&count=1&language=en&format=json` +
    (/^\d{5}$/.test(q) ? '&countryCode=US' : '')
  try {
    const res = await fetch(url)
    const j = (await res.json()) as {
      results?: { latitude: number; longitude: number; name: string; admin1?: string }[]
    }
    const r = j.results?.[0]
    if (!r) return null
    return {
      lat: r.latitude,
      lon: r.longitude,
      name: r.name,
      place: r.name + (r.admin1 ? `, ${r.admin1}` : ''),
    }
  } catch {
    return null
  }
}

const SUN =
  'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'
const PARTLY =
  'M5.5 10a3.5 3.5 0 0 1 6.4-1.9M9 3.5v1.8M3.5 9h1.8M5.1 5.1l1.3 1.3M10 20h7.5a3 3 0 0 0 .3-6A4.8 4.8 0 0 0 8.6 12.6 3.6 3.6 0 0 0 10 20z'
const CLOUD = 'M7 18h9.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 10.2 4 4 0 0 0 7 18z'
const RAIN =
  'M7 15h9.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 7.2 4 4 0 0 0 7 15zM8.5 18l-.8 2.2M12.5 18l-.8 2.2M16.5 18l-.8 2.2'
const SNOW =
  'M7 15h9.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 7.2 4 4 0 0 0 7 15zM8.5 18.5l.02 0M12.5 20.5l.02 0M16.5 18.5l.02 0'
const STORM =
  'M7 14h9.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 6.2 4 4 0 0 0 7 14zM12.8 15.5l-2.3 3.5h3.2l-2.3 3.5'
const FOG = 'M7 14h9.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 6.2 4 4 0 0 0 7 14zM6 17.5h12M8 20.5h8'

/** WMO weather code → icon path. */
export function weatherIcon(code: number): string {
  if (code === 0) return SUN
  if (code <= 2) return PARTLY
  if (code === 3) return CLOUD
  if (code === 45 || code === 48) return FOG
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return SNOW
  if (code >= 95) return STORM
  return RAIN
}

/** Forecast at an event's start time, for the little chip on each agenda row. */
export function weatherAt(wx: Weather | null, ds: string, hm: string | null): { t: string; d: string } | null {
  if (!wx) return null
  const hour = wx.hr[`${ds}T${(hm ?? '12:00').slice(0, 2)}`]
  return hour ? { t: `${hour.t}°`, d: weatherIcon(hour.c) } : null
}
