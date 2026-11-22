/** Writing styles the model can use. The guidance is model-facing, so it stays in English for every UI language. */

export const PRESET_STYLES = ['directive', 'literary', 'xml', 'markdown', 'minimal'] as const;
export type PresetStyle = (typeof PRESET_STYLES)[number];

export const CHAR_STYLES = ['prose', 'plist', 'alichat', 'sheet'] as const;
export type CharStyle = (typeof CHAR_STYLES)[number];

export const LORE_STYLES = ['ency', 'atmo', 'plist'] as const;
export type LoreStyle = (typeof LORE_STYLES)[number];

export const PRESET_STYLE_GUIDE: Record<PresetStyle, string> = {
  directive:
    'Directive style: short imperative rules, one per line, addressed to the model in second person ("Write…", "Keep…"). No filler, no explanations, no rhetorical flourish.',
  literary:
    'Literary style: instructions written as flowing, evocative prose that itself demonstrates the desired tone. Still unambiguous: every sentence must carry an actionable requirement.',
  xml: 'XML style: wrap each block\'s content in one descriptive snake_case XML tag (e.g. <narration_rules>…</narration_rules>); inside, use concise rules, one per line. Never nest unrelated topics in one tag.',
  markdown:
    'Markdown style: a short "## Heading" followed by "-" bullet rules. Bold only the single most important phrase of a bullet, if any.',
  minimal:
    'Minimal style: only the essentials in as few tokens as possible. Telegraphic phrasing is fine, but never drop a requirement or make it ambiguous.',
};

export const CHAR_STYLE_GUIDE: Record<CharStyle, string> = {
  prose:
    'Prose style: flowing third-person prose in present tense. Concrete, specific details over adjectives; show habits and contradictions; no lists.',
  plist:
    'PList style: the description is a compact bracketed property list, e.g. [Name\'s appearance: tall, scar over left brow; Name\'s personality: dry, loyal, stubborn; Name\'s likes: …]. Short comma-separated traits, no prose sentences inside the brackets.',
  alichat:
    'Ali:Chat style: the character is revealed through example exchanges — {{user}} asks something and {{char}} answers in their own voice with actions in asterisks. Description is a few short interview-style exchanges; mes_example uses <START> blocks of the same kind.',
  sheet:
    'Sheet style: a structured profile with headed sections (Appearance, Personality, Background, Speech, Relationships, Goals) and short lines under each. Keep it scannable.',
};

export const LORE_STYLE_GUIDE: Record<LoreStyle, string> = {
  ency: 'Encyclopedic style: dry, precise, reference-like; facts first, no purple prose.',
  atmo: 'Atmospheric style: short vivid prose that conveys the feel of the place or thing, while still stating the key facts plainly.',
  plist: 'PList style: compact bracketed traits, e.g. [Name: type; location; ruler; notable features], to save tokens.',
};
