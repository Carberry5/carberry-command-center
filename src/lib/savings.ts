import type { Deal, SavingsStoreId } from '../types.ts'

/**
 * The stores the family actually shops. Shared by the Savings page and the
 * sidecar so the ad URLs, display names and colours can never disagree.
 */

export interface SavingsStore {
  id: SavingsStoreId
  name: string
  /** The weekly ad / deals page — both a link for humans and the sync target. */
  url: string
  color: string
  /** How deals usually arrive from this store, shown under the paste box. */
  hint: string
}

export const SAVINGS_STORES: SavingsStore[] = [
  {
    id: 'foodlion',
    name: 'Food Lion',
    url: 'https://foodlion.com/savings/all-specials',
    color: '#1B7B3C',
    hint: 'Weekly specials roll Wednesday. Select-all on the specials page and paste.',
  },
  {
    id: 'giant',
    name: 'Giant Food',
    url: 'https://giantfood.com/browse-aisles/categories/1/deal-lock',
    color: '#6B2FA0',
    hint: 'Deal Lock prices run longer than a week — paste the Deal Lock aisle.',
  },
  {
    id: 'costco',
    name: 'Costco',
    url: 'https://www.costco.com/s?keyword=OFF&dept=All',
    color: '#0F5DA8',
    hint: 'Paste the "$ OFF" search results, or the monthly savings book email.',
  },
  {
    id: 'amazon',
    name: 'Amazon Prime',
    url: 'https://www.amazon.com/deals',
    color: '#C77B21',
    hint: 'Paste a deals page, a Subscribe & Save email, or any coupon list.',
  },
]

export const storeById = (id: SavingsStoreId): SavingsStore =>
  SAVINGS_STORES.find((s) => s.id === id) ?? SAVINGS_STORES[0]

export const isStoreId = (v: unknown): v is SavingsStoreId =>
  SAVINGS_STORES.some((s) => s.id === v)

/** Deals still worth acting on: not expired as of `today` ("" ends = unknown, keep). */
export function activeDeals(deals: Deal[], today: string): Deal[] {
  return deals.filter((d) => !d.ends || d.ends >= today)
}
