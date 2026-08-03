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
  const { page } = useFamily()
  const { narrow, rootFontSize } = useLayout()
  const Page = PAGES[page]

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'stretch',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        color: INK,
        background: BG,
        fontSize: rootFontSize,
      }}
    >
      <Rail />
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <div
          style={{
            padding: narrow ? '4px 16px 110px' : '6px 30px 44px',
            maxWidth: 1560,
            width: '100%',
            margin: '0 auto',
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
