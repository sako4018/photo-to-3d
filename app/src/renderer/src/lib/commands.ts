import type { PartOperation } from '../api/engine-client'
import type { ChatAction } from './chat-actions'

/**
 * Understands short commands typed in Bulgarian or English, without any AI model:
 * "make it 8 cm", "направи я с 20% по-висока", "завърти я наобратно", "махни основата",
 * "изглади тук", "по-дебело с 2 мм", "опитай пак". Each sentence part is read on its own.
 */
export interface Parsed {
  /** Commands for the whole model (height, turning, base plate, flat cut). */
  actions: ChatAction[]
  /** A change to the picked part of the model. */
  part: { op: PartOperation; amount_mm?: number; strength?: number } | null
  /** Make a new model from the photo. */
  retry: boolean
  undo: boolean
  /** Parts of the text that matched nothing. */
  unknown: string[]
  /** Wishes that are understood but cannot be done here (the panel explains them). */
  cannot: Cannot[]
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text)

/** "8", "8,5", "8.5" before a unit; null when there is none. */
function numberBefore(text: string, unit: string): number | null {
  const found = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${unit})`, 'u').exec(text)
  return found ? Number(found[1].replace(',', '.')) : null
}

const WORD_NUMBERS: Record<string, number> = {
  един: 1, една: 1, едно: 1, два: 2, две: 2, три: 3, четири: 4, пет: 5, шест: 6, седем: 7,
  осем: 8, девет: 9, десет: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10
}

/** Writes number words before a unit as digits, so "два сантиметра" reads like "2 сантиметра". */
function digits(text: string): string {
  return text.replace(
    /(\p{L}+)(?=\s+(?:см|cm|мм|mm|сантим|милим|centim|millim|пъти|times|процент|percent|градус|degree))/gu,
    (word) => (word in WORD_NUMBERS ? String(WORD_NUMBERS[word]) : word)
  )
}

/** Bulgarian written in Latin letters ("napravi q po-goliama") -> Cyrillic. */
const LATIN: [RegExp, string][] = [
  [/sht/g, 'щ'], [/sh/g, 'ш'], [/ch/g, 'ч'], [/zh/g, 'ж'], [/ts/g, 'ц'],
  [/yu|iu/g, 'ю'], [/ya|ia/g, 'я'], [/q/g, 'я'], [/w/g, 'в'], [/x/g, 'х'],
  [/a/g, 'а'], [/b/g, 'б'], [/v/g, 'в'], [/g/g, 'г'], [/d/g, 'д'], [/e/g, 'е'], [/z/g, 'з'],
  [/i/g, 'и'], [/j/g, 'й'], [/k/g, 'к'], [/l/g, 'л'], [/m/g, 'м'], [/n/g, 'н'], [/o/g, 'о'],
  [/p/g, 'п'], [/r/g, 'р'], [/s/g, 'с'], [/t/g, 'т'], [/u/g, 'у'], [/f/g, 'ф'], [/h/g, 'х'],
  [/c/g, 'ц'], [/y/g, 'ъ']
]

export function toCyrillic(text: string): string {
  return LATIN.reduce((result, [latin, cyrillic]) => result.replace(latin, cyrillic), text)
}

/** Words the commands are built from; a word one typo away is read as the right one. */
const VOCABULARY = [
  'завърти', 'обърни', 'основа', 'основата', 'изглади', 'заглади', 'махни', 'премахни', 'изтрий',
  'отрежи', 'плоча', 'плочата', 'стойка', 'удебели', 'изтъни', 'увеличи', 'намали', 'наобратно',
  'наопаки', 'наляво', 'надясно', 'опитай', 'пробвай', 'отново', 'върни', 'отмени', 'сантиметра',
  'милиметра', 'процента', 'височина', 'висока', 'голяма', 'малка', 'дебело', 'тънко', 'грапаво',
  'изправи', 'легне', 'дъното', 'изравни', 'smooth', 'rotate', 'thicker', 'thinner', 'remove',
  'bigger', 'smaller', 'taller', 'upside', 'again', 'base', 'plate',
  // right words that look like a typo of another one above
  'малко', 'леко', 'много', 'доста', 'малки', 'тънка', 'тънък', 'дебела', 'дебел', 'висок', 'високо',
  'основи', 'тънки'
]

/** Edit distance with swapped neighbours counted as one change. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }
  return rows[a.length][b.length]
}

function fixTypos(text: string): string {
  return text.replace(/[\p{L}]{4,}/gu, (word) => {
    if (VOCABULARY.includes(word)) return word
    const allowed = word.length >= 8 ? 2 : 1
    const best = VOCABULARY.find((known) => Math.abs(known.length - word.length) <= allowed && distance(word, known) <= allowed)
    return best ?? word
  })
}

const MM = 'мм|mm|милиметр\\p{L}*|millimet\\p{L}*'
const CM = 'см|cm|сантиметр\\p{L}*|centimet\\p{L}*'
const PERCENT = '%|процент\\p{L}*|percent'

const UNDO = /^(върни|отмени|undo|назад|go back)|върни (го |я )?(както|като) (беше|преди)/u
const RETRY = /опита[йи] (пак|отново)|пробва[йи] (пак|отново)|(направи|пусни|генерирай|създай)\p{L}* (го |я )?(пак|отново)|дай (ми )?(нов|друг)|(нов|още един) опит|generate|try once more|още (веднъж|един път)|нов\p{L}* (вариант|версия|модел)|друг\p{L}* (вариант|версия|модел)|try again|regenerate|recreate|another (version|model|one)|make (it|one) again|do it again|one more time|start over/u
const BASE = /основ|плоч|стойк|подлож|постамент|поставк|\bbase\b|plate|stand\b(?! ?up)/u
const REMOVE_WORDS = /махни|премахни|изтрий|без |не искам|не ми трябва|remove|delete|no |without|take off|get rid|don.?t want/u
const BOTTOM = /дъно|отдолу|долу|bottom/u
const FLAT = /сре[жз]|отреж|израв|плоск|равн|cut|flat|level/u
const ROTATE = /завърт|обърн|rotate|turn|flip|легн|изправ|гледа|наобратно|наопаки|upside|lay|lie\b|stand (it )?up|upright|fac(e|ing)/u
const SMOOTH = /изглад|заглад|грапав|буц|неравн|шупл|полир|smooth|bumpy|rough|lumpy|polish/u
const THICKER = /по[- ]?дебел|удебел|надебел|thicker|fatter|wider here|beef/u
const THINNER = /по[- ]?тън|изтън|thinner|slimmer|skinnier|slim|narrower/u
// complaints mean the opposite wish: "too thin here" = make it thicker
const TOO_THIN = /тън(к|ък)|тъничк|thin\b|skinny|fragile|чуплив/u
const TOO_THICK = /дебел|thick\b|fat\b|bulky/u
const CUT_PART = /махни|премахни|изтрий|отрежи|изрежи|излишн|не трябва да (го |я |е )?(има|тук)|не ми трябва|remove|delete|cut (it |this )?off|get rid|shouldn.?t be there|not supposed to be/u
const BIGGER = /по[- ]?висок|по[- ]?голям|увелич|уголем|taller|bigger|larger|higher|increase|grow/u
const SMALLER = /по[- ]?нис|по[- ]?мал|намал|смал|smaller|shorter|lower|reduce|shrink/u
export type Cannot = 'infill' | 'colour' | 'detail'
const CANNOT: [RegExp, Cannot][] = [
  [/плът|infill|solid|запълн.*вътре|кух|hollow/u, 'infill'],
  [/цвят|цвет|оцвет|боя|боядис|(?<!\p{L})син(я|и|о|ьо)?(?!\p{L})|червен|зелен|жълт|розов|лилав|оранжев|кафяв|colou?r|paint|\b(blue|red|green|yellow|pink|purple|orange|brown)\b/u, 'colour'],
  [/по[- ]?подроб|детайл|detail|sharper|по[- ]?ясн/u, 'detail']
]

function partStrength(text: string): number | undefined {
  if (has(text, /много|силно|повече|още|a lot|strong|more/u)) return 3
  if (has(text, /леко|малко|слабо|a bit|slightly|light/u)) return 1
  return undefined
}

/** Reads one part of a sentence. Returns false when nothing in it was understood. */
function readClause(text: string, result: Parsed): boolean {
  if (has(text, UNDO)) return (result.undo = true)
  if (has(text, RETRY)) return (result.retry = true)

  for (const [pattern, answer] of CANNOT) {
    if (has(text, pattern) && !has(text, BASE)) {
      result.cannot.push(answer)
      return true
    }
  }

  if (has(text, BASE)) {
    const mm = numberBefore(text, MM)
    const thickness = has(text, REMOVE_WORDS) ? 0 : (mm ?? 3)
    result.actions.push({ name: 'base_plate', input: { thickness_mm: thickness } })
    return true
  }

  if (has(text, BOTTOM) && has(text, FLAT)) {
    result.actions.push({ name: 'flat_base_cut', input: { percent: numberBefore(text, PERCENT) ?? 5 } })
    return true
  }

  if (has(text, ROTATE)) {
    if (has(text, /изправ|stand (it )?up|upright|както (е )?беше/u) && !has(text, /наобратно|upside/u)) {
      result.actions.push({ name: 'reset_rotation', input: {} })
      return true
    }
    const bare = /\b(90|180|270)\b/u.exec(text)
    const degrees = numberBefore(text, '°|градус\\p{L}*|degrees?') ?? (bare ? Number(bare[1]) : null)
    const axis = /(?<!\p{L})([xyz]|х)(?!\p{L})/u.exec(text)
    let input: { axis: string; quarter_turns: number }
    if (has(text, /наобратно|обратно|наопаки|с главата надолу|с краката нагоре|upside|на главата|legs up|feet up/u)) input = { axis: 'x', quarter_turns: 2 }
    else if (has(text, /легн|на една страна|настрани|sideways|lay|lie\b|on its side/u)) input = { axis: 'x', quarter_turns: 1 }
    else if (has(text, /наляво|left/u)) input = { axis: 'z', quarter_turns: 1 }
    else if (has(text, /надясно|right/u)) input = { axis: 'z', quarter_turns: 3 }
    else if (has(text, /гърб|гръб|отзад|друга(та)? страна|към мен|towards? me|backwards|\bback\b|other way|around/u)) input = { axis: 'z', quarter_turns: 2 }
    else input = { axis: 'z', quarter_turns: 1 }
    if (degrees !== null) {
      // "90 degrees to the right" turns the other way round than "to the left"
      const turns = Math.round(degrees / 90) * (has(text, /надясно|right/u) ? -1 : 1)
      input.quarter_turns = ((turns % 4) + 4) % 4
    }
    if (axis) input.axis = axis[1] === 'х' ? 'x' : axis[1] // Cyrillic х is the same key as x
    result.actions.push({ name: 'rotate', input })
    return true
  }

  const amount = numberBefore(text, MM) ?? undefined
  if (has(text, CUT_PART)) {
    result.part = { op: 'remove' }
    return true
  }
  if (has(text, SMOOTH)) {
    result.part = { op: 'smooth', strength: partStrength(text) }
    return true
  }
  if (has(text, THICKER)) {
    result.part = { op: 'thicker', amount_mm: amount }
    return true
  }
  if (has(text, THINNER)) {
    result.part = { op: 'thinner', amount_mm: amount }
    return true
  }
  if (has(text, TOO_THIN)) {
    result.part = { op: 'thicker', amount_mm: amount }
    return true
  }
  if (has(text, TOO_THICK)) {
    result.part = { op: 'thinner', amount_mm: amount }
    return true
  }

  const percent = numberBefore(text, PERCENT)
  const cm = numberBefore(text, CM)
  const mm = numberBefore(text, MM)
  const times = /(\d+(?:[.,]\d+)?)\s*(?:пъти|times)/u.exec(text)
  const step = has(text, /малко|леко|мъничко|a bit|a little|slightly/u)
    ? 0.1
    : has(text, /много|доста|страшно|a lot|much|way|far|significantly/u)
      ? 0.5
      : 0.2
  if (times && Number(times[1].replace(',', '.')) > 0) {
    const count = Number(times[1].replace(',', '.'))
    result.actions.push({ name: 'scale', input: { factor: has(text, SMALLER) ? 1 / count : count } })
  } else if (has(text, /двойно|double|twice/u)) {
    result.actions.push({ name: 'scale', input: { factor: has(text, SMALLER) ? 0.5 : 2 } })
  } else if (has(text, /наполовина|половин|half/u)) {
    result.actions.push({ name: 'scale', input: { factor: 0.5 } })
  } else if (percent !== null && has(text, BIGGER)) {
    result.actions.push({ name: 'scale', input: { factor: 1 + percent / 100 } })
  } else if (percent !== null && has(text, SMALLER)) {
    result.actions.push({ name: 'scale', input: { factor: 1 - percent / 100 } })
  } else if (cm !== null) {
    result.actions.push({ name: 'set_height', input: { mm: cm * 10 } })
  } else if (mm !== null) {
    result.actions.push({ name: 'set_height', input: { mm } })
  } else if (has(text, BIGGER)) {
    result.actions.push({ name: 'scale', input: { factor: 1 + step } })
  } else if (has(text, SMALLER)) {
    result.actions.push({ name: 'scale', input: { factor: 1 - step } })
  } else {
    return false
  }
  return true
}

function understood(parsed: Parsed): number {
  return -parsed.unknown.length
}

export function parseCommand(input: string): Parsed {
  const text = input.toLowerCase().replace(/ё/g, 'е')
  const direct = parseText(fixTypos(digits(text)))
  if (direct.unknown.length === 0 || /[а-я]/.test(text)) return direct
  // Latin letters that are not English: maybe Bulgarian written in Latin
  const latin = parseText(fixTypos(digits(toCyrillic(text))))
  return understood(latin) > understood(direct) ? latin : direct
}

function parseText(text: string): Parsed {
  const result: Parsed = { actions: [], part: null, retry: false, undo: false, unknown: [], cannot: [] }
  // "и" / "and" join two commands, but not inside "по-висока и по-широка" style lists of one wish
  const clauses = text
    .split(/(?<!\d),|,(?!\d)|[;!?]|\.(?!\d)|\s+(?:и|и после|после|след това|and|then)\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  for (const clause of clauses) {
    if (!readClause(clause, result)) result.unknown.push(clause)
  }
  return result
}

/** True when the text is written in Cyrillic, so the answer can be in Bulgarian. */
export const isBulgarian = (text: string): boolean => /[а-я]/i.test(text)
