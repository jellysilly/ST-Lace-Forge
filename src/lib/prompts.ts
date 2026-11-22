import type { TextField } from './card';
import type { ChatMsg } from './llm';
import { GENRE_NAME, TONE_GUIDE, isNsfwGenre, type PlotField, type PlotGenre, type PlotPart, type PlotTone } from './plot';
import { blockText, presetOutline } from './preset';
import { CHAR_STYLE_GUIDE, LORE_STYLE_GUIDE, PRESET_STYLE_GUIDE, type CharStyle, type LoreStyle, type PresetStyle } from './styles';
import type { CharacterDoc, Lang, LoreBook, LoreEntry, PersonaDoc, PlotDoc, PresetBlock, PresetDoc } from './types';

/** Settings every request carries. */
export interface Common {
  outLang: Lang;
  globalInstr: string;
  /** The instruction typed in the hearth for this request. */
  instr: string;
  keepMacros?: boolean;
}

const LANG_NAME: Record<Lang, string> = { ru: 'Russian', en: 'English' };

function system(task: string, styleGuide: string, c: Common, schema: string, extra = '') {
  const parts = [
    'You are Lace Forge, an expert prompt engineer, character writer and story designer for AI roleplay front-ends (SillyTavern, Tavo AI, RisuAI and similar).',
    '',
    '# Task',
    task.trim(),
    '',
    '# Style',
    styleGuide,
    ...(extra.trim() ? ['', extra.trim()] : []),
    '',
    '# Rules',
    `- Write every piece of generated content in ${LANG_NAME[c.outLang]}, unless the user's instruction explicitly asks for another language. JSON keys stay in English.`,
    c.keepMacros === false
      ? '- Macros such as {{char}} and {{user}} may be replaced with concrete names if that reads better.'
      : '- Keep SillyTavern macros exactly as written ({{char}}, {{user}}, {{random::…}}, {{getvar::…}} etc.). Never translate, rename or expand them; use {{char}} / {{user}} instead of concrete names where the text refers to the character or the user.',
    '- Be specific and concrete. Avoid clichés, filler and repetition.',
    "- The user's instructions below take priority over the style when they conflict.",
    '- Reply with a single JSON value matching the schema. No commentary before or after it, no markdown fences.',
    '',
    '# JSON schema',
    schema.trim(),
  ];
  if (c.globalInstr.trim()) parts.push('', "# User's standing instruction (applies to every task)", c.globalInstr.trim());
  return parts.join('\n');
}

const userMsg = (body: string, c: Common, emptyHint: string) =>
  [body.trim(), '', "# User's instruction for this request", c.instr.trim() || emptyHint].join('\n');

/* ───────────────────────── presets ───────────────────────── */

export function presetNewBlocks(doc: PresetDoc, count: number, style: PresetStyle, withContext: boolean, c: Common): ChatMsg[] {
  const empty = !doc.blocks.some((b) => !b.marker && b.content.trim());
  const task = `Write ${count} new prompt block${count > 1 ? 's' : ''} for a SillyTavern Chat Completion preset (a set of toggleable system-prompt blocks that steer how the AI writes roleplay).
Each block is one toggle the user can switch on or off, so it must be self-contained and cover one topic (for example: core role, narration style, pacing, dialogue, NSFW handling, formatting, anti-repetition, {{user}} agency).
${count > 1 ? 'Blocks must not overlap: every rule appears in exactly one block.' : ''}
Give each block a short, clear name (2–5 words). role is "system" unless the instruction says otherwise.`;
  const schema = '{"blocks":[{"name":"string","role":"system|user|assistant","content":"string"}]}';
  const ctx = withContext && !empty ? `# Existing preset (context — do not duplicate its rules)\n${presetOutline(doc)}` : '# Existing preset\n(empty — this is a new preset)';
  return [
    { role: 'system', content: system(task, PRESET_STYLE_GUIDE[style], c, schema) },
    { role: 'user', content: userMsg(ctx, c, 'Write sensible, broadly useful blocks for immersive roleplay.') },
  ];
}

export function presetRegenBlock(doc: PresetDoc, block: PresetBlock, style: PresetStyle, withContext: boolean, c: Common): ChatMsg[] {
  const task = `Rewrite one block of a SillyTavern Chat Completion preset following the user's instruction.
If the instruction is empty, improve clarity and remove redundancy while keeping every requirement of the original.
Keep the name unless the instruction asks to change it or the content changed so much that the old name is misleading.`;
  const schema = '{"name":"string","content":"string"}';
  const body = [
    withContext ? `# Rest of the preset (context — do not duplicate)\n${presetOutline(doc, block.id)}\n` : '',
    `# Block to rewrite\nName: ${block.name}\nRole: ${block.role}\n\n${blockText(block)}`,
  ].join('\n');
  return [
    { role: 'system', content: system(task, PRESET_STYLE_GUIDE[style], c, schema) },
    { role: 'user', content: userMsg(body, c, '(none — just improve it)') },
  ];
}

export function presetSplitBlock(block: PresetBlock, style: PresetStyle, c: Common): ChatMsg[] {
  const task = `Split a preset block into atomic mini-instructions, so a model can keep every one of them in mind.
Each mini-instruction is a single, self-contained, unambiguous rule of one or two short sentences.
Keep every requirement from the original — drop nothing and invent nothing that isn't implied. Merge duplicates. Order them by importance.
Do not number them; numbering is added automatically.`;
  const schema = '{"minis":["string"]}';
  return [
    { role: 'system', content: system(task, PRESET_STYLE_GUIDE[style], c, schema) },
    { role: 'user', content: userMsg(`# Block\nName: ${block.name}\n\n${block.content}`, c, '(none)') },
  ];
}

export function presetRegenMini(block: PresetBlock, index: number, style: PresetStyle, c: Common): ChatMsg[] {
  const task = `Rewrite mini-instruction #${index + 1} of a preset block. It must stay one short, self-contained rule and must not repeat the other points.
If the instruction is empty, make it clearer and more precise without changing its meaning.`;
  const list = block.minis.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
  return [
    { role: 'system', content: system(task, PRESET_STYLE_GUIDE[style], c, '{"text":"string"}') },
    { role: 'user', content: userMsg(`# Block "${block.name}"\n${list}\n\n# Rewrite point #${index + 1}`, c, '(none)') },
  ];
}

/* ───────────────────────── characters ───────────────────────── */

const FIELD_GUIDE = `Field guide:
- name: the character's name.
- description: the main definition — appearance, personality, background, habits, speech, relationships. This is where the style applies most.
- personality: a one- or two-sentence summary of the personality.
- scenario: the situation the roleplay starts in, involving {{user}}.
- first_mes: the opening message, written by {{char}} in roleplay form (narration plus dialogue), 2–4 paragraphs. It sets the scene and leaves room for {{user}} to act; never speak, act or think for {{user}}.
- mes_example: 2–3 example exchanges, each starting with <START>, lines prefixed "{{user}}:" and "{{char}}:". They show {{char}}'s voice.
- alternate_greetings: alternative first messages with different openings.
- tags: 3–6 short lowercase tags.
- creator_notes: a short note for people browsing the card.
- system_prompt / post_history_instructions: leave empty unless asked.`;

const CARD_SCHEMA = '{"name":"string","description":"string","personality":"string","scenario":"string","first_mes":"string","mes_example":"string","alternate_greetings":["string"],"tags":["string"],"creator_notes":"string"}';

export function charNew(idea: string, style: CharStyle, c: Common): ChatMsg[] {
  const task = `Create a complete character card (Character Card V2/V3) for roleplay from the user's idea. Make the character vivid, consistent and playable.\n\n${FIELD_GUIDE}\nGive one alternate greeting.`;
  return [
    { role: 'system', content: system(task, CHAR_STYLE_GUIDE[style], c, CARD_SCHEMA) },
    { role: 'user', content: userMsg(`# Idea\n${idea.trim() || '(no idea given — invent an original character)'}`, c, '(none)') },
  ];
}

const cardDump = (ch: CharacterDoc) =>
  JSON.stringify(
    {
      name: ch.name,
      description: ch.description,
      personality: ch.personality,
      scenario: ch.scenario,
      first_mes: ch.first_mes,
      mes_example: ch.mes_example,
      alternate_greetings: ch.alternate_greetings,
      tags: ch.tags,
      creator_notes: ch.creator_notes,
    },
    null,
    1,
  );

export const FILLABLE: (keyof CharacterDoc)[] = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes'];

export function emptyFields(ch: CharacterDoc) {
  return FILLABLE.filter((k) => !String(ch[k] ?? '').trim());
}

export function charFill(ch: CharacterDoc, idea: string, style: CharStyle, c: Common): ChatMsg[] {
  const missing = emptyFields(ch);
  const task = `Fill in the empty fields of an existing character card. Stay consistent with everything already written; do not contradict or rewrite filled fields.\nReturn only these keys: ${missing.join(', ')}.\n\n${FIELD_GUIDE}`;
  const schema = '{' + missing.map((k) => `"${k}":"string"`).join(',') + '}';
  return [
    { role: 'system', content: system(task, CHAR_STYLE_GUIDE[style], c, schema) },
    { role: 'user', content: userMsg(`# Card so far\n${cardDump(ch)}${idea.trim() ? `\n\n# Extra idea\n${idea.trim()}` : ''}`, c, '(none)') },
  ];
}

export function charField(ch: CharacterDoc, field: TextField, idea: string, style: CharStyle, c: Common): ChatMsg[] {
  const task = `Rewrite one field of an existing character card: "${field}". Keep it consistent with the rest of the card.
If the field is empty, write it from scratch. If the instruction is empty, improve it while keeping its facts.\n\n${FIELD_GUIDE}`;
  return [
    { role: 'system', content: system(task, CHAR_STYLE_GUIDE[style], c, '{"value":"string"}') },
    { role: 'user', content: userMsg(`# Card\n${cardDump(ch)}${idea.trim() ? `\n\n# Extra idea\n${idea.trim()}` : ''}\n\n# Field to rewrite\n${field}`, c, '(none — improve it)') },
  ];
}

const PERSONA_GUIDE = `A persona describes the USER's own character ({{user}}) — the one the human plays. The description is written in third person about {{user}}: appearance, personality, background, how they relate to the world. It should give the AI enough to react to {{user}} believably without dictating {{user}}'s actions. Usually 80–250 words.`;

export function personaNew(idea: string, style: CharStyle, c: Common): ChatMsg[] {
  return [
    { role: 'system', content: system(`Create a user persona from the idea.\n\n${PERSONA_GUIDE}`, CHAR_STYLE_GUIDE[style], c, '{"name":"string","description":"string"}') },
    { role: 'user', content: userMsg(`# Idea\n${idea.trim() || '(no idea — invent an interesting persona)'}`, c, '(none)') },
  ];
}

export function personaRewrite(p: PersonaDoc, idea: string, style: CharStyle, c: Common): ChatMsg[] {
  return [
    {
      role: 'system',
      content: system(`Rewrite or complete the description of a user persona. Keep its facts unless told otherwise.\n\n${PERSONA_GUIDE}`, CHAR_STYLE_GUIDE[style], c, '{"description":"string"}'),
    },
    { role: 'user', content: userMsg(`# Persona\nName: ${p.name}\n\n${p.description || '(empty)'}${idea.trim() ? `\n\n# Extra idea\n${idea.trim()}` : ''}`, c, '(none — improve it)') },
  ];
}

/* ───────────────────────── lorebooks ───────────────────────── */

const LORE_GUIDE = (autoKeys: boolean) => `World Info (lorebook) entries are injected into the prompt only when one of their keys appears in recent chat, so:
- title: a short name for the entry.
- content: what the AI must know about this thing, self-contained (it may be read without the other entries). Usually 40–150 words unless the user asks otherwise. Refer to the subject by name, not "it".
${
  autoKeys
    ? `- keys: 2–6 trigger words people would actually type: the name, short forms, synonyms. For inflected languages (Russian etc.) add word stems so every case form matches (e.g. "башн" matches "башня", "башни", "башню").
- secondary: optional extra keys that narrow activation; usually leave empty.`
    : '- keys: just the entry title. secondary: empty.'
}
- constant: true only for 1–2 core entries that must always be present (world overview, key rules); everything else false.`;

const ENTRY_SCHEMA = '{"title":"string","keys":["string"],"secondary":["string"],"content":"string","constant":false}';

const bookIndex = (book: LoreBook) =>
  book.entries.length
    ? book.entries.map((e) => `- ${e.title || '(untitled)'} [${e.keys.join(', ')}]${e.constant ? ' (constant)' : ''}`).join('\n')
    : '(no entries yet)';

export function loreWorld(book: LoreBook, source: string, count: number, style: LoreStyle, autoKeys: boolean, c: Common): ChatMsg[] {
  const task = `Build a lorebook for roleplay from the user's world description: ${count} entries covering the most useful places, factions, characters, items, customs and rules of the world. Also give the lorebook a short name.\n\n${LORE_GUIDE(autoKeys)}`;
  return [
    { role: 'system', content: system(task, LORE_STYLE_GUIDE[style], c, `{"name":"string","entries":[${ENTRY_SCHEMA}]}`) },
    {
      role: 'user',
      content: userMsg(`# World description\n${source.trim() || '(none — invent an original setting)'}${book.entries.length ? `\n\n# Entries that already exist (do not duplicate)\n${bookIndex(book)}` : ''}`, c, '(none)'),
    },
  ];
}

export function loreAdd(book: LoreBook, source: string, count: number, style: LoreStyle, autoKeys: boolean, c: Common): ChatMsg[] {
  const task = `Add ${count} new entries to an existing lorebook: fill gaps, stay consistent with what exists, never duplicate an existing entry.\n\n${LORE_GUIDE(autoKeys)}`;
  const sample = book.entries
    .slice(0, 6)
    .map((e) => `## ${e.title}\n${e.content.slice(0, 400)}`)
    .join('\n\n');
  return [
    { role: 'system', content: system(task, LORE_STYLE_GUIDE[style], c, `{"entries":[${ENTRY_SCHEMA}]}`) },
    {
      role: 'user',
      content: userMsg(`# Lorebook "${book.name}" — index\n${bookIndex(book)}\n\n# Sample entries (for tone and facts)\n${sample || '(none)'}\n\n# What is missing\n${source.trim() || '(decide yourself what would be most useful)'}`, c, '(none)'),
    },
  ];
}

export function loreRegen(book: LoreBook, e: LoreEntry, source: string, style: LoreStyle, autoKeys: boolean, c: Common): ChatMsg[] {
  const task = `Rewrite one lorebook entry following the user's request. Keep it consistent with the rest of the lorebook. If the request is empty, improve clarity and usefulness while keeping its facts.\n\n${LORE_GUIDE(autoKeys)}`;
  return [
    { role: 'system', content: system(task, LORE_STYLE_GUIDE[style], c, ENTRY_SCHEMA) },
    {
      role: 'user',
      content: userMsg(
        `# Lorebook index\n${bookIndex(book)}\n\n# Entry to rewrite\nTitle: ${e.title}\nKeys: ${e.keys.join(', ')}\nSecondary: ${e.secondary.join(', ')}\nConstant: ${e.constant}\n\n${e.content}${source.trim() ? `\n\n# What to change\n${source.trim()}` : ''}`,
        c,
        '(none)',
      ),
    },
  ];
}

export function loreKeys(e: LoreEntry, c: Common): ChatMsg[] {
  const task = `Suggest activation keys for a lorebook entry.\n\n${LORE_GUIDE(true)}`;
  return [
    { role: 'system', content: system(task, LORE_STYLE_GUIDE.ency, { ...c, instr: '' }, '{"keys":["string"],"secondary":["string"]}') },
    { role: 'user', content: userMsg(`# Entry\nTitle: ${e.title}\nCurrent keys: ${e.keys.join(', ') || '(none)'}\n\n${e.content}`, { ...c, instr: '' }, '(none)') },
  ];
}

/* ───────────────────────── plots ───────────────────────── */

export interface PlotOpts {
  genres: PlotGenre[];
  tone: PlotTone;
  nsfw: boolean;
}

/** Library items the story should be built around. */
export interface PlotCtx {
  character?: CharacterDoc;
  persona?: PersonaDoc;
  book?: LoreBook;
}

const PLOT_STYLE = `Storytelling: concrete, vivid and specific. Every character wants something and has a reason; conflicts escalate; developments are surprising yet logical. The story is built for roleplay: {{user}} is a participant with real choices, not a spectator, so leave decisions open instead of scripting {{user}}'s actions. Avoid clichés (chosen ones, amnesia, "it was all a dream", meeting in a tavern) unless the user asks for them.`;

const SFW_MODE = `# Content mode: SFW
Keep everything suitable for a general audience:
- No explicit sexual content: romance and attraction may be shown, but intimate scenes fade to black.
- Violence may happen but is not graphic; no gore or torture details.
- If the user's idea or instruction asks for explicit content, write a tasteful SFW version instead of refusing.`;

const NSFW_MODE = `# Content mode: NSFW (18+)
The user is an adult and has turned on mature content.
- Explicit sexual content, erotic tension, nudity, graphic violence, gore and dark or disturbing themes are allowed whenever the story or the user's request calls for them. Write them plainly: do not sanitize, fade to black, moralize or add warnings.
- Mature content serves the story: it has motivation, consequences and character, not just shock value.
- Hard limits, always: every character in sexual or sexualized content is an adult (18+) and clearly described as one; never sexualize minors or childlike characters, whatever the setting or claimed age. No sexual content involving real, identifiable people.`;

const PLOT_GUIDE = (beats: number) => `Field guide:
- title: a short evocative title (2–6 words).
- logline: one or two sentences — who, what they want, what stands in the way, and the hook.
- tags: 3–6 short lowercase tags (genre, themes, mood).
- setting: place, time, atmosphere and the world rules that matter to this story; 80–200 words.
- cast: 3–6 key characters, one per line: "Name — role in the story, what they want, a secret or contradiction". The first line is {{user}}'s role in the story.
- synopsis: the overall arc in 120–250 words — the inciting incident, how the conflict escalates, the central dilemma and two or three possible outcomes depending on {{user}}'s choices.
- beats: ${beats} story beats (scenes) in order. Each has a short title and 2–4 sentences: what happens, what is at stake, and the choice or pressure it puts on {{user}}.
- twists: 2–4 twists or complications the narrator can bring in, one per line.
- opening: the opening scene that starts the roleplay, 2–4 paragraphs of narration and dialogue, ending on a hook that invites {{user}} to act. Never speak, act or think for {{user}}.
Refer to the player's character as {{user}}. If a character card is given, that character is {{char}}; without a card, do not use {{char}} and give every character a proper name.`;

const PLOT_SCHEMA = '{"title":"string","logline":"string","tags":["string"],"setting":"string","cast":"string","synopsis":"string","beats":[{"title":"string","text":"string"}],"twists":"string","opening":"string"}';
const BEATS_SCHEMA = '{"beats":[{"title":"string","text":"string"}]}';

function plotStyle(o: PlotOpts) {
  const genres = o.genres.filter((g) => o.nsfw || !isNsfwGenre(g)).map((g) => GENRE_NAME[g]);
  return `${PLOT_STYLE}\nGenres: ${genres.length ? genres.join(', ') : 'any — choose freely'}.\nTone: ${TONE_GUIDE[o.tone]}.`;
}

const contentMode = (nsfw: boolean) => (nsfw ? NSFW_MODE : SFW_MODE);

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

export function plotContext(x: PlotCtx) {
  const out: string[] = [];
  const ch = x.character;
  if (ch)
    out.push(
      [
        '# Character card — build the story around this character ({{char}})',
        `Name: ${ch.name}`,
        cut(ch.description.trim(), 3000),
        ch.personality.trim() && `Personality: ${cut(ch.personality.trim(), 400)}`,
        ch.scenario.trim() && `Card scenario: ${cut(ch.scenario.trim(), 600)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  if (x.persona) out.push(`# The user's persona ({{user}})\nName: ${x.persona.name}\n${cut(x.persona.description.trim(), 1500)}`);
  const entries = x.book?.entries.filter((e) => e.enabled && e.content.trim()) ?? [];
  if (x.book && entries.length)
    out.push(
      `# World lorebook "${x.book.name}" — stay consistent with it\n` +
        entries
          .slice(0, 40)
          .map((e) => `- ${e.title || e.keys[0] || '?'}: ${cut(e.content.trim().replace(/\s+/g, ' '), 240)}`)
          .join('\n'),
    );
  return out.join('\n\n');
}

const withCtx = (body: string, ctx: PlotCtx) => {
  const extra = plotContext(ctx);
  return extra ? `${body}\n\n${extra}` : body;
};

const plotDump = (p: PlotDoc) =>
  JSON.stringify(
    {
      title: p.title,
      logline: p.logline,
      tags: p.tags,
      setting: p.setting,
      cast: p.cast,
      synopsis: p.synopsis,
      beats: p.beats.map((b) => ({ title: b.title, text: b.text })),
      twists: p.twists,
      opening: p.opening,
    },
    null,
    1,
  );

export function plotIdeas(seed: string, count: number, avoid: string[], o: PlotOpts, ctx: PlotCtx, c: Common): ChatMsg[] {
  const task = `Come up with ${count} original story idea${count > 1 ? 's' : ''} for roleplay${ctx.character ? ' built around the given character' : ''}. Each idea is a premise the user could play out with an AI narrator.
- title: 2–6 words.
- logline: 2–3 sentences — the situation, what {{user}} is drawn into, what stands in the way, and the hook or twist that makes it worth playing.
- tags: 2–4 short lowercase tags.
${count > 1 ? 'The ideas must differ in setting, conflict and mood; no two may feel like variations of one premise.' : ''}`;
  const body = [`# What the ideas should be about\n${seed.trim() || '(nothing specific — surprise me)'}`, avoid.length ? `# Ideas already on the board (do not repeat them)\n${avoid.map((x) => '- ' + x).join('\n')}` : ''].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system(task, plotStyle(o), c, '{"ideas":[{"title":"string","logline":"string","tags":["string"]}]}', contentMode(o.nsfw)) },
    { role: 'user', content: userMsg(withCtx(body, ctx), c, '(none)') },
  ];
}

export function plotNew(seed: string, beats: number, o: PlotOpts, ctx: PlotCtx, c: Common): ChatMsg[] {
  const task = `Write a complete roleplay story plot from the user's idea.\n\n${PLOT_GUIDE(beats)}`;
  return [
    { role: 'system', content: system(task, plotStyle(o), c, PLOT_SCHEMA, contentMode(o.nsfw)) },
    { role: 'user', content: userMsg(withCtx(`# Idea\n${seed.trim() || '(no idea given — invent an original story)'}`, ctx), c, '(none)') },
  ];
}

export function plotFill(p: PlotDoc, missing: PlotPart[], seed: string, beats: number, o: PlotOpts, ctx: PlotCtx, c: Common): ChatMsg[] {
  const task = `Fill in the empty parts of an existing story plot. Stay consistent with everything already written; do not contradict or rewrite filled parts.\nReturn only these keys: ${missing.join(', ')}.\n\n${PLOT_GUIDE(beats)}`;
  const schema = '{' + missing.map((k) => (k === 'beats' ? '"beats":[{"title":"string","text":"string"}]' : k === 'tags' ? '"tags":["string"]' : `"${k}":"string"`)).join(',') + '}';
  return [
    { role: 'system', content: system(task, plotStyle(o), c, schema, contentMode(o.nsfw)) },
    { role: 'user', content: userMsg(withCtx(`# Plot so far\n${plotDump(p)}${seed.trim() ? `\n\n# Extra idea\n${seed.trim()}` : ''}`, ctx), c, '(none)') },
  ];
}

export function plotField(p: PlotDoc, field: PlotField | 'beats', seed: string, beats: number, o: PlotOpts, ctx: PlotCtx, c: Common): ChatMsg[] {
  const isBeats = field === 'beats';
  const n = p.beats.length || beats;
  const task = isBeats
    ? `Rewrite the story beats of an existing plot following the user's instruction: ${n} beats in order. Keep them consistent with the rest of the plot. If the instruction is empty, make them sharper and more playable while keeping the story.\n\n${PLOT_GUIDE(n)}`
    : `Rewrite one part of an existing story plot: "${field}". Keep it consistent with the rest of the plot.\nIf the part is empty, write it from scratch. If the instruction is empty, improve it while keeping its facts.\n\n${PLOT_GUIDE(n)}`;
  return [
    { role: 'system', content: system(task, plotStyle(o), c, isBeats ? BEATS_SCHEMA : '{"value":"string"}', contentMode(o.nsfw)) },
    { role: 'user', content: userMsg(withCtx(`# Plot\n${plotDump(p)}${seed.trim() ? `\n\n# Extra idea\n${seed.trim()}` : ''}\n\n# Part to rewrite\n${field}`, ctx), c, '(none — improve it)') },
  ];
}

export function plotMore(p: PlotDoc, count: number, seed: string, o: PlotOpts, ctx: PlotCtx, c: Common): ChatMsg[] {
  const task = `Continue an existing story plot: write ${count} new beat${count > 1 ? 's' : ''} that follow the last one. Raise the stakes, pay off earlier set-ups and twists, and keep {{user}}'s choices open. Do not repeat or rewrite existing beats.\n\n${PLOT_GUIDE(count)}`;
  return [
    { role: 'system', content: system(task, plotStyle(o), c, BEATS_SCHEMA, contentMode(o.nsfw)) },
    { role: 'user', content: userMsg(withCtx(`# Plot so far\n${plotDump(p)}\n\n# Where the story should go next\n${seed.trim() || '(decide yourself)'}`, ctx), c, '(none)') },
  ];
}

/* ───────────────────────── greeting from a plot ───────────────────────── */

/** Longest plot text sent as a greeting source; longer files are cut. */
export const GREET_SOURCE_MAX = 16000;

export type GreetTarget = 'first' | 'alt';

/** A library plot as greeting source. */
export const plotSource = (p: PlotDoc) => plotDump(p);

export function charGreeting(ch: CharacterDoc, source: string, target: GreetTarget, idea: string, nsfw: boolean, c: Common): ChatMsg[] {
  const which =
    target === 'first'
      ? 'the first message (greeting) of the character card. It replaces the current first message, if there is one; you may keep its good details.'
      : 'a new alternate greeting for the character card. It must open the story differently from the existing first message and alternate greetings (another moment of the plot, another place or angle), not rewrite them.';
  const task = `Write ${which}
Use the story plot below as the source of the setting, situation and stakes: start the roleplay at a fitting moment of the plot and bring in its hook. Where the plot and the card disagree about who {{char}} is, the card wins; adapt the plot around it.
The greeting is written by {{char}} in roleplay form — narration plus dialogue, 2–5 paragraphs, in {{char}}'s voice — and ends with an opening that invites {{user}} to act. Never speak, act or think for {{user}}. Do not retell the whole plot or give away its twists.`;
  const style =
    "Match the formatting of the card's existing greetings and example dialogue (asterisks for actions, quotes for speech, tense and person) when there are any; otherwise write third-person narration with dialogue in quotes. Concrete sensory details, no purple prose.";
  const body = `# Character card\n${cardDump(ch)}\n\n# Story plot (source)\n${cut(source.trim(), GREET_SOURCE_MAX)}${idea.trim() ? `\n\n# Extra idea\n${idea.trim()}` : ''}`;
  return [
    { role: 'system', content: system(task, style, c, '{"value":"string"}', contentMode(nsfw)) },
    { role: 'user', content: userMsg(body, c, '(none)') },
  ];
}
