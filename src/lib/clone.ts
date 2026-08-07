/**
 * A deep copy of plain family data.
 *
 * structuredClone is the right tool and is used when it exists — but it needs
 * Chrome 98, and this app is meant to run on whatever browser a kitchen device
 * happens to ship. Amazon's Silk on an Echo Show is the case that prompted
 * this: FamilyStore.update() clones on *every* edit, so an absent
 * structuredClone is not a graceful degradation, it is a ReferenceError the
 * first time anybody ticks a checkbox.
 *
 * The fallback is JSON, which is lossless for FamilyData specifically: it is
 * strings, numbers, booleans, plain objects and arrays, with no Date, Map, Set,
 * undefined-valued key or cycle anywhere in src/types.ts. If that ever stops
 * being true, this is the thing that will quietly drop the new field.
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
