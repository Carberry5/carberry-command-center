/**
 * Exercises the crop geometry in src/lib/photo.ts.
 *
 * Only coverRect is tested: everything below it in that file needs a canvas and
 * a real image decoder, which is exactly why the geometry was pulled out. The
 * part that can be silently wrong — cropping a face off the top of a portrait —
 * is arithmetic, and arithmetic can be checked here.
 *
 *   npx tsx scripts/photo-test.ts
 */

import { AVATAR_SIZE, MAX_INPUT_BYTES, coverRect, encodedSize } from '../src/lib/photo.ts'

let checks = 0
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (n: string) => console.log(`\n${n}`)

// ---------------------------------------------------------------------------

section('the crop is the largest centred square')
{
  // A phone portrait, which is what these actually are.
  const p = coverRect(1179, 1572)
  check('takes the full width', p.size === 1179, String(p.size))
  check('no horizontal offset', p.sx === 0)
  check('centred vertically', p.sy === Math.round((1572 - 1179) / 2), String(p.sy))
  // The bug worth guarding: anchoring at the top of a portrait crops to a
  // forehead. sy must be well clear of zero.
  check('not anchored at the top', p.sy > 100, String(p.sy))

  const l = coverRect(4032, 3024)
  check('a landscape takes the full height', l.size === 3024)
  check('and is centred horizontally', l.sx === Math.round((4032 - 3024) / 2), String(l.sx))
  check('with no vertical offset', l.sy === 0)

  const sq = coverRect(800, 800)
  check('a square is untouched', sq.size === 800 && sq.sx === 0 && sq.sy === 0)
}

section('the crop always fits inside the source')
{
  for (const [w, h] of [[1179, 1572], [4032, 3024], [800, 800], [1, 3], [3, 1], [1000, 1001]]) {
    const r = coverRect(w, h)
    check(
      `${w}x${h} stays in bounds`,
      r.sx >= 0 && r.sy >= 0 && r.sx + r.size <= w && r.sy + r.size <= h,
      JSON.stringify(r)
    )
  }
}

section('degenerate input does not produce a negative or zero crop')
{
  // drawImage with a zero or negative source size throws, which would surface
  // as "could not read that image" for a file that was perfectly fine.
  for (const [w, h] of [[0, 0], [0, 500], [500, 0], [-10, 20]]) {
    const r = coverRect(w, h)
    check(`${w}x${h} gives a positive size`, r.size >= 1, JSON.stringify(r))
    check(`${w}x${h} gives non-negative offsets`, r.sx >= 0 && r.sy >= 0, JSON.stringify(r))
  }
}

section('the stored avatar stays small')
{
  check('256px is the target', AVATAR_SIZE === 256)
  // A 256x256 JPEG at 0.82 lands around 15-25 KB; base64 adds a third. The
  // point of the check is that this is kilobytes, not megabytes — Member.photo
  // is a text column the differ compares on every edit.
  const typicalJpeg = 22 * 1024
  check('a typical avatar encodes under 40 KB', encodedSize(typicalJpeg) < 40 * 1024,
    `${Math.round(encodedSize(typicalJpeg) / 1024)} KB`)
  check('base64 overhead is about a third',
    encodedSize(3000) === 4000, String(encodedSize(3000)))
  check('the input guard is generous but finite', MAX_INPUT_BYTES === 25 * 1024 * 1024)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
