import type { PartOperation } from '../api/engine-client'
import type { Cannot } from './commands'

/** Answers of the "Fix a part" box, in the language the user typed in. */
const REPLIES = {
  en: {
    done: 'Done.',
    needPart: 'Click the part on the model first, then say it again.',
    retry: 'Making a new version from the photo. It takes about 2 minutes.',
    nothingToUndo: 'There is nothing to undo.',
    undone: 'Undone.',
    unknown: (text: string) =>
      `I did not understand "${text}". Try: "8 cm", "turn it upside down", "add a base", ` +
      '"smooth here", "thicker", "remove this", "try again".',
    part: {
      smooth: 'Smoothed the picked part.',
      thicker: 'Made the picked part thicker.',
      thinner: 'Made the picked part thinner.',
      remove: 'Removed the picked part and closed the surface.'
    } satisfies Record<PartOperation, string>,
    cannot: {
      infill: 'How full the inside is (infill) is set in the slicer, not here. The model itself is already solid.',
      colour: 'The model has no colour: it prints in the colour of your filament.',
      detail: 'For more detail, choose Detailed under "New version from the photo".'
    } satisfies Record<Cannot, string>
  },
  bg: {
    done: 'Готово.',
    needPart: 'Първо кликни върху частта на модела, после го напиши пак.',
    retry: 'Правя нова версия от снимката. Отнема около 2 минути.',
    nothingToUndo: 'Няма какво да върна.',
    undone: 'Върнах го.',
    unknown: (text: string) =>
      `Не разбрах „${text}“. Пробвай: „8 см“, „завърти я наобратно“, „сложи основа“, ` +
      '„изглади тук“, „по-дебело“, „махни това“, „опитай пак“.',
    part: {
      smooth: 'Изгладих избраната част.',
      thicker: 'Удебелих избраната част.',
      thinner: 'Изтъних избраната част.',
      remove: 'Махнах избраната част и затворих повърхността.'
    } satisfies Record<PartOperation, string>,
    cannot: {
      infill: 'Колко е плътна отвътре (infill) се избира в слайсъра, не тук. Самият модел вече е плътно тяло.',
      colour: 'Моделът няма цвят: печата се в цвета на филамента.',
      detail: 'За повече детайли избери Detailed под „New version from the photo“.'
    } satisfies Record<Cannot, string>
  }
}

export type Replies = (typeof REPLIES)['en']

export function replies(bulgarian: boolean): Replies {
  return bulgarian ? REPLIES.bg : REPLIES.en
}
