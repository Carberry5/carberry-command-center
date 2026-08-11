import { BG, INK } from './lib/theme.ts'
import { useFamily, useLayout } from './store/FamilyStore.tsx'
import { Header } from './components/Header.tsx'
import { Rail } from './components/Rail.tsx'
import { PinPad, Toast, VoiceOverlay } from './components/Overlays.tsx'
import { EventModal } from './components/modals/EventModal.tsx'
import {
  ChoreModal,
  CountdownModal,
  DayDetailModal,
  IntegrationModal,
  MealPickModal,
  PlanNightModal,
  RedeemModal,
  RewardModal,
} from './components/modals/index.tsx'
import { TodayPage } from './pages/Today.tsx'
import { MemberPage } from './pages/Member.tsx'
import { CalendarPage } from './pages/Calendar.tsx'
import { ChoresPage } from './pages/Chores.tsx'
import { MealsPage } from './pages/Meals.tsx'
import { SavingsPage } from './pages/Savings.tsx'
import { ListsPage } from './pages/Lists.tsx'
import { CountdownsPage } from './pages/Countdowns.tsx'
import { SidekickPage } from './pages/Sidekick.tsx'
import { SettingsPage } from './pages/Settings.tsx'
import { DisplayPage } from './pages/Display.tsx'

const PAGES = {
  today: TodayPage,
  member: MemberPage,
  calendar: CalendarPage,
  chores: ChoresPage,
  meals: MealsPage,
  savings: SavingsPage,
  lists: ListsPage,
  countdowns: CountdownsPage,
  sidekick: SidekickPage,
  settings: SettingsPage,
} as const

export function App() {
  const { page, prefs } = useFamily()
  const { narrow, rootFontSize } = useLayout()
  const Page = PAGES[page]

  // Wall-display mode replaces the whole shell rather than hiding parts of it:
  // the rail, the header and the page padding all exist to support navigation,
  // and a kitchen display navigates nowhere. Modals stay mounted so a toast can
  // still surface, but nothing on this screen opens one.
  if (prefs.display) return <DisplayPage />

  return (
    <div
      style={{
        // On a desktop or a wall display the shell is pinned to the viewport
        // and `main` does the scrolling, so a page asking for the leftover
        // height gets a real number instead of stretching the window: a
        // content-sized shell resolves `flex: 1` against the page's own
        // max-content, which pushed the month grid off the bottom.
        //
        // Phones keep the document scrolling the way they always have — 100vh
        // there is a lie told by a collapsing URL bar, and the bottom tab rail
        // is already fixed.
        ...(narrow ? { minHeight: '100vh' } : { height: '100vh', overflow: 'hidden' }),
        display: 'flex',
        alignItems: 'stretch',
        fontFamily: "'Jost', 'Plus Jakarta Sans', sans-serif",
        color: INK,
        background: BG,
        fontSize: rootFontSize,
      }}
    >
      <Rail />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          ...(narrow ? {} : { overflowY: 'auto', overflowX: 'hidden' }),
        }}
      >
        <Header />
        <div
          style={{
            padding: narrow ? '4px 16px 110px' : '6px 30px 24px',
            maxWidth: 1560,
            width: '100%',
            margin: '0 auto',
            // A flex column so a page can ask for the leftover height instead
            // of stopping at its content — the calendar's day cards run to the
            // bottom of the window this way. Pages that don't opt in are
            // unaffected: a lone flex item with basis:auto keeps its own size.
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Page />
        </div>
      </main>

      <EventModal />
      <ChoreModal />
      <RewardModal />
      <RedeemModal />
      <MealPickModal />
      <PlanNightModal />
      <CountdownModal />
      <IntegrationModal />
      <DayDetailModal />
      <PinPad />
      <VoiceOverlay />
      <Toast />
    </div>
  )
}
