import type { FamilyData, Member, Preflight } from '../types.ts'
import { addDays, dowOf, uid, ymd } from '../lib/dates.ts'

/**
 * The Carberry family's starting data. Used the first time the app runs against
 * an empty vault, and by Settings → "Reset demo data".
 */

const PRESET_PREFLIGHT: Record<string, { gym: number[]; lun: number[]; bring: { id: string; text: string; days: number[] }[] }> = {
  c: {
    gym: [2, 4],
    lun: [1, 2, 3, 4, 5],
    bring: [
      { id: 'b1', text: 'Swim bag', days: [1] },
      { id: 'b2', text: 'Library book', days: [3] },
    ],
  },
  h: {
    gym: [1, 3],
    lun: [1, 2, 3, 4, 5],
    bring: [
      { id: 'b3', text: 'Violin', days: [2] },
      { id: 'b4', text: 'Library book', days: [5] },
    ],
  },
  r: {
    gym: [5],
    lun: [1, 3, 5],
    bring: [{ id: 'b5', text: 'Show & tell item', days: [5] }],
  },
}

export function seedPreflight(members: Member[]): Preflight {
  const cfg: Preflight = { open: true, depart: '07:30', kids: {} }
  members
    .filter((m) => m.role === 'kid')
    .forEach((k) => {
      cfg.kids[k.id] = PRESET_PREFLIGHT[k.id] ?? { gym: [], lun: [1, 2, 3, 4, 5], bring: [] }
    })
  return cfg
}

export function seed(): FamilyData {
  const t = new Date()
  const td = ymd(t)
  const dow = t.getDay()
  /** Date of `target` weekday, `weeks` weeks from the current week. */
  const onDow = (weeks: number, target: number) => {
    const d = new Date(t)
    d.setDate(d.getDate() - dow + target + weeks * 7)
    return ymd(d)
  }
  /**
   * A fixed calendar date — birthdays, first day of school. Rolls to next year
   * once it's past, so a countdown that has come and gone starts counting to the
   * next one instead of sitting at zero forever.
   */
  const onDate = (month: number, day: number) => {
    const d = new Date(t.getFullYear(), month - 1, day)
    if (ymd(d) < td) d.setFullYear(d.getFullYear() + 1)
    return ymd(d)
  }

  const members: Member[] = [
    { id: 'p', name: 'Patrick', role: 'parent', color: '#4A5B8C' , links: [] },
    { id: 'e', name: 'Elizabeth', role: 'parent', color: '#0F8B8D' , links: [] },
    { id: 'c', name: 'Cannon', role: 'kid', age: 9, color: '#3D6DE8', photo: 'assets/cannon.png' , links: [] },
    { id: 'h', name: 'Hadley', role: 'kid', age: 7, color: '#8B5CF6' , links: [] },
    { id: 'r', name: 'Rowan', role: 'kid', age: 4, color: '#31A05F', photo: 'assets/rowan.png' , links: [] },
  ]

  const events = [
    { id: uid(), title: 'Swim team practice', date: onDow(0, 1), start: '16:00', dur: 60, memberIds: ['c'], loc: 'Rec center pool', recur: 'weekly' as const },
    { id: uid(), title: 'Soccer practice', date: onDow(0, 2), start: '17:30', dur: 60, memberIds: ['h'], loc: 'Algonkian Park, Field 3', recur: 'weekly' as const },
    { id: uid(), title: 'Gymnastics — Little Flips', date: onDow(0, 6), start: '09:30', dur: 45, memberIds: ['r'], loc: 'Little Flips Gym', recur: 'weekly' as const },
    { id: uid(), title: 'Piano lesson', date: onDow(0, 4), start: '16:30', dur: 30, memberIds: ['c'], loc: 'Ms. Alvarez', recur: 'weekly' as const },
    { id: uid(), title: 'Family movie night', date: onDow(0, 5), start: '19:00', dur: 120, memberIds: [], loc: 'Living room', recur: 'weekly' as const },
    { id: uid(), title: 'Book club', date: onDow(0, 3), start: '19:30', dur: 90, memberIds: ['e'], loc: "Priya's house", recur: 'weekly' as const },
    { id: uid(), title: 'Dentist — Hadley', date: onDow(1, 2), start: '14:00', dur: 45, memberIds: ['h', 'e'], loc: 'Smile Studio', recur: null },
    { id: uid(), title: 'Farmers market', date: onDow(1, 6), start: '10:00', dur: 60, memberIds: [], loc: 'Old Town', recur: null },
    { id: uid(), title: "Sleepover at Gran's", date: onDow(1, 5), start: '17:00', dur: null, memberIds: ['c', 'h', 'r'], loc: "Gran's house", recur: null },
    { id: uid(), title: 'Library storytime', date: td, start: '10:30', dur: 45, memberIds: ['r', 'e'], loc: 'Cascades Library', recur: null },
    { id: uid(), title: 'Pool day with the Nguyens', date: td, start: '15:00', dur: 120, memberIds: [], loc: 'Community pool', recur: null },
  ]

  const chores = [
    { id: 'c1', title: 'Brush teeth (AM & PM)', memberIds: ['c', 'h', 'r'], days: [0, 1, 2, 3, 4, 5, 6], stars: 1 },
    { id: 'c2', title: 'Make your bed', memberIds: ['c', 'h', 'r'], days: [0, 1, 2, 3, 4, 5, 6], stars: 1 },
    { id: 'c3', title: 'Drink your water', memberIds: ['c', 'h', 'r'], days: [0, 1, 2, 3, 4, 5, 6], stars: 1 },
    { id: 'c4', title: 'Reading & homework', memberIds: ['c', 'h'], days: [1, 2, 3, 4, 5], stars: 2 },
    { id: 'c5', title: 'Clean your room', memberIds: ['c', 'h', 'r'], days: [3, 6], stars: 2 },
    { id: 'c6', title: 'Sleep in your own bed', memberIds: ['h', 'r'], days: [0, 1, 2, 3, 4, 5, 6], stars: 2 },
    { id: 'c7', title: 'Feed the dogs', memberIds: ['c', 'h', 'r'], days: [0, 1, 2, 3, 4, 5, 6], stars: 1 },
    { id: 'c8', title: 'Take the trash out', memberIds: ['c', 'h'], days: [1, 4], stars: 2 },
    { id: 'c9', title: 'Put your laundry away', memberIds: ['c', 'h', 'r'], days: [0, 3], stars: 2 },
  ]

  // A week of plausible history so the star chart and balances aren't empty.
  const done: FamilyData['done'] = {}
  for (let i = 1; i <= 6; i++) {
    const day = addDays(td, -i)
    const dw = dowOf(day)
    const dd: Record<string, 1> = {}
    chores.forEach((ch, ci) =>
      ch.memberIds.forEach((k, ki) => {
        if (ch.days.includes(dw) && (i + ci + ki) % 4 !== 0) dd[`${ch.id}|${k}`] = 1
      })
    )
    done[day] = dd
  }
  done[td] = { 'c1|c': 1, 'c1|h': 1, 'c1|r': 1, 'c2|c': 1, 'c3|r': 1 }

  const favorites = [
    { id: uid(), name: 'Taco night', tag: 'Crowd favorite' },
    { id: uid(), name: 'Pork Belly Candy', tag: 'Weekend treat' },
    { id: uid(), name: 'Chicken Nuggets & French Fries', tag: 'Kids pick' },
    { id: uid(), name: 'Steak', tag: 'Weekend' },
    { id: uid(), name: 'Sushi', tag: 'Takeout' },
    { id: uid(), name: 'Seafood', tag: '' },
    { id: uid(), name: 'Asian', tag: '' },
    { id: uid(), name: 'Sheet-pan chicken & veg', tag: 'Easy' },
    { id: uid(), name: 'Homemade pizza', tag: 'Friday classic' },
    { id: uid(), name: 'Breakfast-for-dinner', tag: 'Kids pick' },
    { id: uid(), name: 'Teriyaki salmon bowls', tag: 'Healthy' },
    { id: uid(), name: 'Mac & cheese + broccoli', tag: '15 min' },
  ]

  const mealPlan: Record<string, string> = {
    [addDays(td, -1)]: 'Steak',
    [td]: 'Taco night',
    [addDays(td, 1)]: 'Sheet-pan chicken & veg',
    [addDays(td, 2)]: 'Homemade pizza',
  }

  const data: FamilyData = {
    members,
    events,
    chores,
    done,
    rewards: [
      { id: 'r1', title: 'Pick movie night movie', cost: 10 },
      { id: 'r2', title: '30 min extra screen time', cost: 8 },
      { id: 'r3', title: 'Ice cream outing', cost: 15 },
      { id: 'r4', title: 'Stay up 30 min late', cost: 12 },
      { id: 'r5', title: 'Pick Friday dinner', cost: 10 },
      { id: 'r6', title: '$5 pocket money', cost: 25 },
    ],
    redemptions: [
      { id: uid(), kidId: 'h', title: '30 min extra screen time', cost: 8, ts: Date.now() - 2 * 864e5 },
      { id: uid(), kidId: 'c', title: 'Pick movie night movie', cost: 10, ts: Date.now() - 5 * 864e5 },
    ],
    favorites,
    mealPlan,
    lists: [
      {
        id: 'l1',
        name: 'Groceries',
        items: [
          { id: uid(), text: 'Milk', done: false, by: 'e' },
          { id: uid(), text: 'Eggs', done: false, by: 'e' },
          { id: uid(), text: 'Strawberries', done: true, by: 'h' },
          { id: uid(), text: 'String cheese', done: false, by: 'r' },
          { id: uid(), text: 'Goldfish crackers', done: false, by: 'c' },
          { id: uid(), text: 'Chicken thighs', done: false, by: 'e' },
          { id: uid(), text: 'Tortillas', done: false, by: 'e' },
        ],
      },
      {
        id: 'l2',
        name: 'Target run',
        items: [
          { id: uid(), text: 'Sunscreen SPF 50', done: false, by: 'e' },
          { id: uid(), text: 'Pool noodles', done: false, by: 'r' },
          { id: uid(), text: 'Birthday card for Gran', done: false, by: 'e' },
        ],
      },
      {
        id: 'l3',
        name: 'Summer bucket list',
        items: [
          { id: uid(), text: 'Catch fireflies', done: true, by: 'h' },
          { id: uid(), text: 'Water balloon fight', done: false, by: 'c' },
          { id: uid(), text: 'Great Falls hike', done: false, by: 'e' },
          { id: uid(), text: 'Build a blanket fort', done: true, by: 'r' },
        ],
      },
    ],
    countdowns: [
      { id: uid(), title: 'Beach week — OBX', date: addDays(td, 8), memberId: null },
      { id: uid(), title: 'First day of school', date: onDate(8, 20), memberId: null },
      { id: uid(), title: "Rowan's birthday — turning 5", date: onDate(9, 10), memberId: 'r' },
      { id: uid(), title: "Hadley's birthday — turning 8", date: onDate(10, 26), memberId: 'h' },
      { id: uid(), title: "Cannon's birthday — turning 10", date: onDate(1, 1), memberId: 'c' },
      { id: uid(), title: "Cannon's swim meet", date: addDays(td, 9), memberId: 'c' },
    ],
    settings: {
      pin: '1234',
      zip: '20165',
      lat: 39.065,
      lon: -77.395,
      place: 'Potomac Falls, VA',
      feeds: [
        {
          id: 'f1',
          name: 'School calendar (LCPS)',
          url: 'https://www.lcps.org/calendars/calendar.ics',
          color: '#5B8DEF',
          status: 'Not synced yet',
          memberIds: [],
        },
      ],
    },
    feedEv: {},
    preflight: seedPreflight(members),
    fit: {
      p: { kind: 'whoop', sleep: 84, strain: 12.4 },
      e: { kind: 'oura', sleep: 88, act: 72 },
    },
    gl: {
      c: {
        bal: 46.5, allow: 8, goal: 'New lacrosse head', goalCost: 90, saved: 32,
        pay: [{ d: 'Fri', for: 'Chore payout', amt: 4 }, { d: 'Tue', for: 'Trash + recycling', amt: 1.5 }],
      },
      h: {
        bal: 28.75, allow: 6, goal: 'Telescope fund', goalCost: 120, saved: 54,
        pay: [{ d: 'Fri', for: 'Chore payout', amt: 3.5 }, { d: 'Sat', for: 'Pet care bonus', amt: 1 }],
      },
      r: {
        bal: 12.25, allow: 4, goal: 'RC monster truck', goalCost: 60, saved: 18,
        pay: [{ d: 'Fri', for: 'Chore payout', amt: 2 }, { d: 'Sun', for: 'Room rescue', amt: 0.75 }],
      },
    },
    secrets: [],
    savings: {
      // What the family buys every week — deals are matched against this list.
      staples: [
        { id: 'st-milk', name: 'Milk', category: 'Dairy' },
        { id: 'st-eggs', name: 'Eggs', category: 'Dairy' },
        { id: 'st-string-cheese', name: 'String cheese', category: 'Dairy' },
        { id: 'st-yogurt', name: 'Yogurt', category: 'Dairy' },
        { id: 'st-butter', name: 'Butter', category: 'Dairy' },
        { id: 'st-strawberries', name: 'Strawberries', category: 'Produce' },
        { id: 'st-bananas', name: 'Bananas', category: 'Produce' },
        { id: 'st-apples', name: 'Apples', category: 'Produce' },
        { id: 'st-broccoli', name: 'Broccoli', category: 'Produce' },
        { id: 'st-chicken-thighs', name: 'Chicken thighs', category: 'Meat' },
        { id: 'st-chicken-breast', name: 'Chicken breast', category: 'Meat' },
        { id: 'st-ground-beef', name: 'Ground beef', category: 'Meat' },
        { id: 'st-steak', name: 'Steak', category: 'Meat', note: 'Weekend dinners' },
        { id: 'st-salmon', name: 'Salmon', category: 'Meat' },
        { id: 'st-bread', name: 'Sandwich bread', category: 'Pantry' },
        { id: 'st-tortillas', name: 'Tortillas', category: 'Pantry', note: 'Taco night' },
        { id: 'st-goldfish', name: 'Goldfish crackers', category: 'Snacks' },
        { id: 'st-granola-bars', name: 'Granola bars', category: 'Snacks' },
        { id: 'st-coffee', name: 'Coffee', category: 'Pantry' },
        { id: 'st-cereal', name: 'Cereal', category: 'Pantry' },
        { id: 'st-pasta', name: 'Pasta', category: 'Pantry' },
        { id: 'st-paper-towels', name: 'Paper towels', category: 'Household' },
        { id: 'st-laundry', name: 'Laundry detergent', category: 'Household' },
        { id: 'st-dog-food', name: 'Dog food', category: 'Household' },
      ],
      deals: [],
      status: {},
      plan: null,
    },
  }

  return data
}
