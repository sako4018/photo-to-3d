import { describe, expect, it } from 'vitest'
import { parseCommand, type Parsed } from './commands'

/**
 * Phrases written the way people really type them (Bulgarian, English, Bulgarian in Latin
 * letters, no hyphens, small typos), with what the app must do. The short form:
 * height:80  scale:1.2  rotate:x2  plate:3  cut:10  part:smooth  part:thicker:2
 * retry  undo  cannot  unknown
 */
const CORPUS: [string, string][] = [
  // height
  ['направи я 8 см', 'height:80'],
  ['искам да е висока 12 сантиметра', 'height:120'],
  ['височина 65 мм', 'height:65'],
  ['70мм', 'height:70'],
  ['да е 10 см', 'height:100'],
  ['направи я десет сантиметра', 'height:100'],
  ['7,5 см', 'height:75'],
  ['make it 80mm tall', 'height:80'],
  ['height 120 mm', 'height:120'],
  ['5 cm please', 'height:50'],
  ['napravi q 8 sm', 'height:80'],
  // relative size
  ['направи я с 20% по-висока', 'scale:1.2'],
  ['с 20 процента по-голяма', 'scale:1.2'],
  ['по висока с 10%', 'scale:1.1'],
  ['увеличи я с 50%', 'scale:1.5'],
  ['намали я с 25%', 'scale:0.75'],
  ['по-малка с 30 %', 'scale:0.7'],
  ['по-голяма', 'scale:1.2'],
  ['по-малка', 'scale:0.8'],
  ['малко по-голяма', 'scale:1.1'],
  ['много по-голяма', 'scale:1.5'],
  ['двойно по-голяма', 'scale:2'],
  ['два пъти по-малка', 'scale:0.5'],
  ['наполовина', 'scale:0.5'],
  ['направи я по голяма', 'scale:1.2'],
  ['make it bigger', 'scale:1.2'],
  ['20% smaller', 'scale:0.8'],
  ['make it twice as big', 'scale:2'],
  ['half the size', 'scale:0.5'],
  ['a bit smaller', 'scale:0.9'],
  ['po-goliama', 'scale:1.2'],
  ['uvelichi q s 20%', 'scale:1.2'],
  // turning
  ['завърти я наобратно', 'rotate:x2'],
  ['обърни я с главата надолу', 'rotate:x2'],
  ['обърни я наопаки', 'rotate:x2'],
  ['завърти я наляво', 'rotate:z1'],
  ['завърти я надясно', 'rotate:z3'],
  ['завърти я', 'rotate:z1'],
  ['обърни я с гръб', 'rotate:z2'],
  ['завърти я на 180 градуса', 'rotate:z2'],
  ['завърти я на 90° по x', 'rotate:x1'],
  ['нека легне', 'rotate:x1'],
  ['сложи я да легне на една страна', 'rotate:x1'],
  ['изправи я', 'rotate:reset'],
  ['turn it upside down', 'rotate:x2'],
  ['rotate it 90 degrees', 'rotate:z1'],
  ['rotate 270 around z', 'rotate:z3'],
  ['turn it to the left', 'rotate:z1'],
  ['lay it on its side', 'rotate:x1'],
  ['zavarti q naobratno', 'rotate:x2'],
  ['завурти я', 'rotate:z1'],
  // base plate and flat cut
  ['сложи основа', 'plate:3'],
  ['добави плоча отдолу', 'plate:3'],
  ['основа 5 мм', 'plate:5'],
  ['искам по-дебела основа 6мм', 'plate:6'],
  ['махни основата', 'plate:0'],
  ['без основа', 'plate:0'],
  ['сложи стойка', 'plate:3'],
  ['add a base', 'plate:3'],
  ['remove the base plate', 'plate:0'],
  ['base 4mm', 'plate:4'],
  ['slozhi osnova', 'plate:3'],
  ['оснва', 'plate:3'],
  ['отрежи дъното', 'cut:5'],
  ['изравни дъното с 10%', 'cut:10'],
  ['направи я плоска отдолу', 'cut:5'],
  ['cut the bottom flat', 'cut:5'],
  ['flatten the bottom by 8%', 'cut:8'],
  // one part
  ['изглади', 'part:smooth'],
  ['изглади тук', 'part:smooth'],
  ['тук е грапаво', 'part:smooth'],
  ['има буци тук, оправи ги', 'part:smooth'],
  ['изглади го много', 'part:smooth:3'],
  ['леко изглади', 'part:smooth:1'],
  ['заглади повърхността', 'part:smooth'],
  ['тук е неравно', 'part:smooth'],
  ['smooth this', 'part:smooth'],
  ['this part is bumpy', 'part:smooth'],
  ['izgladi tuk', 'part:smooth'],
  ['направи го по-дебело', 'part:thicker'],
  ['по дебело', 'part:thicker'],
  ['удебели ръката', 'part:thicker'],
  ['по-дебело с 2 мм', 'part:thicker:2'],
  ['тук е много тънко', 'part:thicker'],
  ['кракът е твърде тънък', 'part:thicker'],
  ['make it thicker', 'part:thicker'],
  ['this is too thin', 'part:thicker'],
  ['направи го по-тънко', 'part:thinner'],
  ['тук е прекалено дебело', 'part:thinner'],
  ['изтъни малко', 'part:thinner'],
  ['make this thinner by 1 mm', 'part:thinner:1'],
  ['too thick here', 'part:thinner'],
  ['махни това парче', 'part:remove'],
  ['махни това', 'part:remove'],
  ['изтрий тази част', 'part:remove'],
  ['това не трябва да го има', 'part:remove'],
  ['отрежи това', 'part:remove'],
  ['тук има излишно', 'part:remove'],
  ['remove this', 'part:remove'],
  ['get rid of this blob', 'part:remove'],
  ['mahni tova', 'part:remove'],
  // try again, undo
  ['опитай пак', 'retry'],
  ['не ми харесва, опитай отново', 'retry'],
  ['направи нов вариант', 'retry'],
  ['пробвай пак', 'retry'],
  ['дай друга версия', 'retry'],
  ['try again', 'retry'],
  ['regenerate', 'retry'],
  ['probvai pak', 'retry'],
  ['върни', 'undo'],
  ['върни както беше', 'undo'],
  ['отмени последното', 'undo'],
  ['undo', 'undo'],
  ['go back', 'undo'],
  // understood, but not possible here
  ['направи я плътна', 'cannot'],
  ['искам да е плътна', 'cannot'],
  ['оцвети я в червено', 'cannot'],
  ['make it solid', 'cannot'],
  ['more detail please', 'cannot'],
  ['по-детайлна', 'cannot'],
  // not understood
  ['направи я като дракон', 'unknown'],
  ['здравей', 'unknown'],
  // several at once
  ['направи я с 20% по-висока и сложи основа', 'scale:1.2 plate:3'],
  ['8 см, завърти я наобратно и махни основата', 'height:80 rotate:x2 plate:0'],
  ['make it 6 cm and add a base', 'height:60 plate:3'],
  ['изглади го и после го направи 7 см', 'height:70 part:smooth']
]

/** A second list, written after the rules, to check they work on phrases they were not tuned on. */
const UNSEEN: [string, string][] = [
  ['може ли да е 9 см висока', 'height:90'],
  ['искам я 15см', 'height:150'],
  ['направи фигурката 45 милиметра', 'height:45'],
  ['make the figure 100 millimeters', 'height:100'],
  ['set height to 7 cm', 'height:70'],
  ['по-ниска с 10 процента', 'scale:0.9'],
  ['смали я малко', 'scale:0.9'],
  ['уголеми я', 'scale:1.2'],
  ['три пъти по-голяма', 'scale:3'],
  ['make it a little taller', 'scale:1.1'],
  ['shrink it by 40%', 'scale:0.6'],
  ['make it much bigger', 'scale:1.5'],
  ['завърти я на другата страна', 'rotate:z2'],
  ['обърни я на 90 градуса', 'rotate:z1'],
  ['да гледа наляво', 'rotate:z1'],
  ['сложи я легнала', 'rotate:x1'],
  ['flip it', 'rotate:z1'],
  ['turn it around', 'rotate:z2'],
  ['rotate it to the right', 'rotate:z3'],
  ['make it stand up', 'rotate:reset'],
  ['завъртиия наобратно', 'rotate:x2'],
  ['искам подложка отдолу', 'plate:3'],
  ['дебелина на основата 2 мм', 'plate:2'],
  ['не искам основа', 'plate:0'],
  ['махни плочата', 'plate:0'],
  ['put it on a stand', 'plate:3'],
  ['no base please', 'plate:0'],
  ['add a 5mm plate', 'plate:5'],
  ['изрежи дъното равно', 'cut:5'],
  ['направи дъното равно', 'cut:5'],
  ['flat bottom', 'cut:5'],
  ['оправи грапавините', 'part:smooth'],
  ['повърхността тук е на буци', 'part:smooth'],
  ['изгладете това', 'part:smooth'],
  ['make it smoother here', 'part:smooth'],
  ['smooth it out a lot', 'part:smooth:3'],
  ['ръката е много тънка', 'part:thicker'],
  ['удебели го с 1 мм', 'part:thicker:1'],
  ['ще се счупи, тук е тънко', 'part:thicker'],
  ['thicken this part', 'part:thicker'],
  ['the leg is too skinny', 'part:thicker'],
  ['направи носа по-тънък', 'part:thinner'],
  ['тук е прекалено дебел', 'part:thinner'],
  ['slim this down', 'part:thinner'],
  ['изтрий това', 'part:remove'],
  ['махни тази буца', 'part:remove'],
  ['отрежи тази част', 'part:remove'],
  ['delete this piece', 'part:remove'],
  ['cut this off', 'part:remove'],
  ['това парче е излишно', 'part:remove'],
  ['направи го отново', 'retry'],
  ['пусни го пак', 'retry'],
  ['генерирай нов модел', 'retry'],
  ['make another one', 'retry'],
  ['do it again', 'retry'],
  ['отмени', 'undo'],
  ['върни назад', 'undo'],
  ['върни предишното', 'undo'],
  ['undo that', 'undo'],
  ['направи я цветна', 'cannot'],
  ['искам повече детайли', 'cannot'],
  ['make it hollow', 'cannot'],
  ['колко струва', 'unknown'],
  ['благодаря', 'unknown'],
  ['изглади го и сложи основа', 'plate:3 part:smooth'],
  ['10 см и наобратно', 'height:100 rotate:x2']
]

/** A third list, also written blind, kept to watch for rules that fit only the lists above. */
const UNSEEN_2: [string, string][] = [
  ['искам височината да е 6 см', 'height:60'],
  ['направи я 12 cm', 'height:120'],
  ['височина: 55мм', 'height:55'],
  ['make it about 9cm high', 'height:90'],
  ['малко по-малка', 'scale:0.9'],
  ['доста по-висока', 'scale:1.5'],
  ['увеличи я двойно', 'scale:2'],
  ['make it 15% larger', 'scale:1.15'],
  ['bigger please', 'scale:1.2'],
  ['обърни я обратно', 'rotate:x2'],
  ['завърти я с лице към мен', 'rotate:z2'],
  ['завърти я на 270 градуса', 'rotate:z3'],
  ['turn it 90 degrees to the left', 'rotate:z1'],
  ['make it lie down', 'rotate:x1'],
  ['сложи основа от 4 мм', 'plate:4'],
  ['махни подложката', 'plate:0'],
  ['add a thicker base of 6 mm', 'plate:6'],
  ['take off the plate', 'plate:0'],
  ['отрежи малко отдолу', 'cut:5'],
  ['make the bottom flat', 'cut:5'],
  ['тук е много грапаво, изглади го', 'part:smooth'],
  ['make this area smoother', 'part:smooth'],
  ['ухото е твърде тънко', 'part:thicker'],
  ['make the arm thicker by 2 mm', 'part:thicker:2'],
  ['тази част е прекалено дебела', 'part:thinner'],
  ['make it slimmer here', 'part:thinner'],
  ['махни това нещо', 'part:remove'],
  ['remove that bump', 'part:remove'],
  ['не ми харесва, дай нов', 'retry'],
  ['опитай още веднъж', 'retry'],
  ['regenerate it', 'retry'],
  ['върни го', 'undo'],
  ['undo the last change', 'undo'],
  ['направи я кухa', 'cannot'],
  ['боядисай я', 'cannot'],
  ['какво можеш', 'unknown'],
  ['сложи основа и я завърти наляво', 'plate:3 rotate:z1']
]

/** A fourth list, written blind after all the fixes above: the honest final check. */
const UNSEEN_3: [string, string][] = [
  ['искам да е висока точно 4 см', 'height:40'],
  ['направи фигурата 11см', 'height:110'],
  ['make it 3 cm tall', 'height:30'],
  ['височината да е 90 милиметра', 'height:90'],
  ['малко по-висока', 'scale:1.1'],
  ['доста по-малка', 'scale:0.5'],
  ['увеличи я с 5 процента', 'scale:1.05'],
  ['make it 50% bigger', 'scale:1.5'],
  ['make it way smaller', 'scale:0.5'],
  ['smaller', 'scale:0.8'],
  ['обърни я с краката нагоре', 'rotate:x2'],
  ['завърти я 90 градуса надясно', 'rotate:z3'],
  ['завърти я наобратно по y', 'rotate:y2'],
  ['flip it upside down', 'rotate:x2'],
  ['rotate it 180', 'rotate:z2'],
  ['make it stand upright again', 'rotate:reset'],
  ['добави основа 2мм', 'plate:2'],
  ['сложи я на поставка', 'plate:3'],
  ['махни долната плоча', 'plate:0'],
  ['without the base', 'plate:0'],
  ['the base should be 8 mm', 'plate:8'],
  ['направи дъното плоско с 4%', 'cut:4'],
  ['cut 6% off the bottom', 'cut:6'],
  ['изглади малко тук', 'part:smooth:1'],
  ['оправи неравностите', 'part:smooth'],
  ['make it less bumpy', 'part:smooth'],
  ['полиране на тази част', 'part:smooth'],
  ['удебели тази част с 3 мм', 'part:thicker:3'],
  ['опашката е прекалено тънка', 'part:thicker'],
  ['make the neck thicker', 'part:thicker'],
  ['направи ушите по-тънки', 'part:thinner'],
  ['the arm is too thick', 'part:thinner'],
  ['махни тази пъпка', 'part:remove'],
  ['това е излишно, изтрий го', 'part:remove'],
  ['remove this lump', 'part:remove'],
  ['нов опит', 'retry'],
  ['пробвай с друг вариант', 'retry'],
  ['generate again', 'retry'],
  ['върни последната промяна', 'undo'],
  ['undo please', 'undo'],
  ['искам я по-плътна', 'cannot'],
  ['направи я синя', 'cannot'],
  ['what can you do', 'unknown'],
  ['изглади го и после го завърти наляво', 'rotate:z1 part:smooth'],
  ['5 см и основа 2 мм', 'height:50 plate:2']
]

function describeParsed(parsed: Parsed): string {
  const words: string[] = []
  for (const { name, input } of parsed.actions) {
    if (name === 'set_height') words.push(`height:${input.mm}`)
    if (name === 'scale') words.push(`scale:${Math.round((input.factor as number) * 100) / 100}`)
    if (name === 'rotate') words.push(`rotate:${input.axis}${input.quarter_turns}`)
    if (name === 'base_plate') words.push(`plate:${input.thickness_mm}`)
    if (name === 'flat_base_cut') words.push(`cut:${input.percent}`)
    if (name === 'reset_rotation') words.push('rotate:reset')
  }
  if (parsed.part) {
    const extra = parsed.part.amount_mm ?? parsed.part.strength
    words.push(`part:${parsed.part.op}${extra !== undefined ? `:${extra}` : ''}`)
  }
  if (parsed.retry) words.push('retry')
  if (parsed.undo) words.push('undo')
  if (parsed.cannot.length > 0) words.push('cannot')
  if (words.length === 0 && parsed.unknown.length > 0) words.push('unknown')
  return words.join(' ')
}

function check(list: [string, string][]): string[] {
  return list
    .map(([text, expected]) => ({ text, expected, got: describeParsed(parseCommand(text)) }))
    .filter((row) => row.got !== row.expected)
    .map((row) => `${row.text}  →  ${row.got || '(nothing)'}  (expected ${row.expected})`)
}

describe('parseCommand on real phrases', () => {
  it('understands every phrase of the list', () => {
    const wrong = check(CORPUS)
    expect(wrong, `${CORPUS.length - wrong.length} of ${CORPUS.length} understood`).toEqual([])
  })

  it('understands a third list written blind', () => {
    const wrong = check(UNSEEN_2)
    expect(wrong, `${UNSEEN_2.length - wrong.length} of ${UNSEEN_2.length} understood`).toEqual([])
  })

  it('understands a fourth list written blind after all fixes', () => {
    const wrong = check(UNSEEN_3)
    expect(wrong, `${UNSEEN_3.length - wrong.length} of ${UNSEEN_3.length} understood`).toEqual([])
  })

  it('understands phrases it was not tuned on', () => {
    const wrong = check(UNSEEN)
    expect(wrong, `${UNSEEN.length - wrong.length} of ${UNSEEN.length} understood`).toEqual([])
  })
})
