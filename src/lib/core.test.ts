import { describe, expect, it } from 'vitest';
import { cardFromJson, cardFromPng, cardToPng, emptyCharacter, personaToPng, personasFrom, personasToST, toV2, toV3 } from './card';
import { extractJson, repairJson } from './json';
import { importLorebook, lorebookFrom, newEntry, toCharacterBook, toSTWorld } from './lorebook';
import { emptyPlot, emptyPlotParts, newBeat, parseIdeas, plotPatch, plotToCard, plotToMarkdown, type PlotLabels } from './plot';
import { isPng, readTextChunks, writeTextChunks } from './png';
import { blockText, emptyPreset, importPreset, newBlock, toSillyTavern } from './preset';
import { GREET_SOURCE_MAX, charFill, charGreeting, emptyFields, loreWorld, plotFill, plotIdeas, plotNew, plotSource, presetNewBlocks, presetSplitBlock } from './prompts';
import type { LoreBook } from './types';
import { base64ToBytes, utf8 } from './util';

const PNG_1x1 = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const common = { outLang: 'ru' as const, globalInstr: 'GLOBAL-RULE', instr: 'USER-RULE' };

describe('presets', () => {
  it('exports a SillyTavern preset with prompts and matching prompt_order', () => {
    const doc = emptyPreset('Test');
    doc.blocks[0].content = 'You are the narrator.';
    const st = toSillyTavern(doc);
    const ids = new Set(st.prompts.map((p) => p.identifier));
    expect(st.prompt_order.map((o) => o.character_id)).toEqual([100000, 100001]);
    for (const o of st.prompt_order[1].order) expect(ids.has(o.identifier)).toBe(true);
    expect(st.prompts.find((p) => p.identifier === 'main')?.content).toBe('You are the narrator.');
    expect(st.prompts.find((p) => p.identifier === 'chatHistory')?.marker).toBe(true);
    expect(typeof st.temperature).toBe('number');
  });

  it('round-trips blocks, order, depth and samplers through import', () => {
    const doc = emptyPreset('Test');
    doc.raw = { ...doc.raw, temperature: 1.37, custom_field: 'kept' };
    const b = newBlock({ name: 'Depth rule', content: 'Stay in character.', position: 1, depth: 2, order: 50, role: 'user', enabled: false });
    doc.blocks.splice(2, 0, b);
    const back = importPreset(JSON.stringify(toSillyTavern(doc)), 'x.json');
    expect(back.blocks.map((x) => x.name)).toEqual(doc.blocks.map((x) => x.name));
    const got = back.blocks.find((x) => x.name === 'Depth rule')!;
    expect(got).toMatchObject({ position: 1, depth: 2, order: 50, role: 'user', enabled: false, content: 'Stay in character.' });
    expect(back.raw?.temperature).toBe(1.37);
    expect(back.raw?.custom_field).toBe('kept');
  });

  it('sends mini-instructions instead of the content and restores both on import', () => {
    const doc = emptyPreset('Test');
    doc.blocks[0] = { ...doc.blocks[0], content: 'Long original text.', minis: [{ id: 'a', text: 'First.' }, { id: 'b', text: 'Second.' }] };
    expect(blockText(doc.blocks[0])).toBe('1. First.\n2. Second.');
    const st = toSillyTavern(doc);
    expect(st.prompts.find((p) => p.identifier === 'main')?.content).toBe('1. First.\n2. Second.');
    const back = importPreset(JSON.stringify(st), 'x.json');
    expect(back.blocks[0].content).toBe('Long original text.');
    expect(back.blocks[0].minis.map((m) => m.text)).toEqual(['First.', 'Second.']);
  });

  it('uses the 100001 order and keeps prompts missing from it', () => {
    const json = {
      prompts: [
        { identifier: 'main', name: 'Main', content: 'A' },
        { identifier: 'x1', name: 'Orphan', content: 'B' },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
      ],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: 'chatHistory', enabled: true }] },
        { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
      ],
    };
    const doc = importPreset(JSON.stringify(json), 'p.json');
    expect(doc.blocks.map((b) => b.identifier)).toEqual(['main', 'chatHistory', 'x1']);
    expect(doc.blocks[2].enabled).toBe(false);
  });

  it('rejects files that are not presets', () => {
    expect(() => importPreset('{"foo":1}', 'a.json')).toThrow('not-preset');
    expect(() => importPreset('nope', 'a.json')).toThrow('json');
  });
});

describe('png chunks', () => {
  it('writes and reads tEXt chunks, replacing old ones', () => {
    expect(isPng(PNG_1x1)).toBe(true);
    const once = writeTextChunks(PNG_1x1, { chara: 'AAAA' });
    const twice = writeTextChunks(once, { chara: 'BBBB', ccv3: 'CCCC' });
    expect(readTextChunks(twice)).toEqual({ chara: 'BBBB', ccv3: 'CCCC' });
    expect(isPng(twice)).toBe(true);
  });
});

describe('character cards', () => {
  const c = { ...emptyCharacter('Мирей'), description: 'Часовщица из Нойрхафена.', first_mes: 'Колокольчик звякнул.', tags: ['fantasy'], alternate_greetings: ['Привет'] };

  it('reads V1, V2 and V3 objects', () => {
    expect(cardFromJson({ name: 'A', description: 'd', first_mes: 'f' }).spec).toBe('v1');
    const v2 = cardFromJson(toV2(c));
    expect(v2.spec).toBe('v2');
    expect(v2.description).toBe(c.description);
    const v3 = cardFromJson(toV3(c));
    expect(v3).toMatchObject({ spec: 'v3', name: 'Мирей', tags: ['fantasy'], alternate_greetings: ['Привет'] });
    expect(() => cardFromJson({ foo: 1 })).toThrow('not-card');
  });

  it('keeps extensions and an embedded lorebook through export', () => {
    const src = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...toV3(c).data, extensions: { depth_prompt: { prompt: 'x', depth: 4 } }, character_book: { entries: [{ keys: ['tower'], content: 'A tower.' }] } } };
    const card = cardFromJson(src);
    const out = toV3(card).data as Record<string, unknown>;
    expect(out.extensions).toEqual({ depth_prompt: { prompt: 'x', depth: 4 } });
    expect(lorebookFrom({ character_book: out.character_book }, 'b').entries[0].keys).toEqual(['tower']);
    // V3-only keys don't leak into V2.
    expect('group_only_greetings' in (toV2(card).data as object)).toBe(false);
  });

  it('embeds cards in PNG (Cyrillic-safe) and reads them back', () => {
    const png = cardToPng(c, PNG_1x1);
    const back = cardFromPng(png);
    expect(back.name).toBe('Мирей');
    expect(back.first_mes).toBe('Колокольчик звякнул.');
    expect(back.spec).toBe('v3');
    expect(back.avatar?.startsWith('data:image/png;base64,')).toBe(true);
    expect(() => cardFromPng(PNG_1x1)).toThrow('no-card-in-png');
  });
});

describe('personas', () => {
  it('exports the ST backup format and imports it again', () => {
    const st = personasToST([{ id: '12345678-x', name: 'Странница', description: 'Переплётчица.', updatedAt: 0 }]);
    const back = personasFrom(utf8.encode(JSON.stringify(st)), 'personas.json');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: 'Странница', description: 'Переплётчица.' });
  });

  it('reads persona PNGs, cards and plain text', () => {
    const png = personaToPng({ id: '1', name: 'Smith', description: 'Burnt palms.', updatedAt: 0 }, PNG_1x1);
    expect(personasFrom(png, 'p.png')[0]).toMatchObject({ name: 'Smith', description: 'Burnt palms.' });
    expect(personasFrom(utf8.encode('Just text'), 'Bob.txt')[0]).toMatchObject({ name: 'Bob', description: 'Just text' });
  });
});

describe('lorebooks', () => {
  const book: LoreBook = {
    id: 'b',
    name: 'Нойрхафен',
    updatedAt: 0,
    entries: [
      newEntry({ title: 'Город', keys: ['Нойрхафен'], constant: true, content: 'Туманный порт.', order: 10 }),
      newEntry({ title: 'Башня', keys: ['башн', 'часы'], secondary: ['полночь'], logic: 3, content: 'Бьёт тринадцать раз.', position: 4, depth: 2, role: 1, probability: 60, wholeWords: false, enabled: false }),
    ],
  };

  it('round-trips through the ST World Info format', () => {
    const st = toSTWorld(book);
    const e1 = (st.entries as Record<string, Record<string, unknown>>)['1'];
    expect(e1).toMatchObject({ uid: 1, key: ['башн', 'часы'], keysecondary: ['полночь'], selective: true, selectiveLogic: 3, disable: true, useProbability: true });
    const back = importLorebook(JSON.stringify(st), 'world.json');
    expect(back.entries).toHaveLength(2);
    expect(back.entries[1]).toMatchObject({ title: 'Башня', logic: 3, position: 4, depth: 2, role: 1, probability: 60, wholeWords: false, enabled: false });
    expect(back.entries[0].constant).toBe(true);
  });

  it('imports character_book entries (array form)', () => {
    const cb = toCharacterBook(book);
    const back = lorebookFrom(cb, 'x');
    expect(back.name).toBe('Нойрхафен');
    expect(back.entries[1]).toMatchObject({ keys: ['башн', 'часы'], position: 4, depth: 2, logic: 3 });
  });

  it('rejects non-lorebooks', () => {
    expect(() => importLorebook('{"a":1}', 'x.json')).toThrow('not-lorebook');
  });
});

describe('model output parsing', () => {
  it('extracts JSON from fenced, chatty or thinking replies', () => {
    expect(extractJson('Вот:\n```json\n{"a": 1}\n```\nГотово!')).toEqual({ a: 1 });
    expect(extractJson('<think>hmm {"no":1}</think>{"b": 2}')).toEqual({ b: 2 });
    expect(extractJson('["x","y"]')).toEqual(['x', 'y']);
  });

  it('repairs raw newlines, trailing commas and truncation', () => {
    const broken = '{"blocks": [{"name": "A", "content": "line1\nline2",}, {"name": "B", "content": "cut off';
    const fixed = JSON.parse(repairJson(broken));
    expect(fixed.blocks[0].content).toBe('line1\nline2');
    expect(fixed.blocks).toHaveLength(2);
  });
});

describe('prompts', () => {
  it('carries style, language, global and own instructions', () => {
    const [sys, user] = presetNewBlocks(emptyPreset('P'), 3, 'xml', true, common);
    expect(sys.content).toContain('XML style');
    expect(sys.content).toContain('Russian');
    expect(sys.content).toContain('GLOBAL-RULE');
    expect(user.content).toContain('USER-RULE');
    expect(sys.content).toContain('3 new prompt blocks');
  });

  it('can drop the macro rule', () => {
    const b = newBlock({ name: 'X', content: 'Y' });
    expect(presetSplitBlock(b, 'minimal', { ...common, keepMacros: false })[0].content).toContain('may be replaced');
  });

  it('asks only for empty card fields when filling', () => {
    const c = { ...emptyCharacter('A'), description: 'filled' };
    const missing = emptyFields(c);
    expect(missing).not.toContain('description');
    expect(missing).toContain('first_mes');
    expect(charFill(c, '', 'plist', common)[0].content).toContain('"first_mes":"string"');
  });

  it('mentions existing entries when generating a world', () => {
    const book: LoreBook = { id: 'b', name: 'B', updatedAt: 0, entries: [newEntry({ title: 'Tower', keys: ['tower'], content: 'x' })] };
    const [, user] = loreWorld(book, 'fog city', 5, 'ency', true, common);
    expect(user.content).toContain('Tower [tower]');
  });
});

describe('plots', () => {
  const labels: PlotLabels = {
    tags: 'Tags',
    beats: 'Scenes',
    fields: { logline: 'Logline', setting: 'Setting', cast: 'Cast', synopsis: 'Synopsis', twists: 'Twists', opening: 'Opening' },
  };
  const plot = {
    ...emptyPlot('Маяк'),
    logline: 'Смотритель встречает себя из будущего.',
    tags: ['mystery'],
    setting: 'Скалистый остров.',
    beats: [newBeat({ title: 'Шторм', text: 'Лодка разбивается о скалы.' })],
    opening: 'Фонарь мигнул.',
    nsfw: true,
  };
  const sfw = { genres: ['mystery', 'erotica'] as const, tone: 'grim' as const, nsfw: false };

  it('reads a plot reply, joining lists the model gave instead of text', () => {
    const json = {
      title: 'T',
      tags: 'a, b',
      cast: [{ name: '{{user}}', role: 'a keeper' }, 'Old Ann — a witch'],
      twists: ['One', 'Two'],
      beats: [{ title: 'Storm', text: 'Rain.' }, 'Plain beat', { title: '', text: '' }],
    };
    const patch = plotPatch(json, ['title', 'tags', 'cast', 'twists', 'beats', 'synopsis']);
    expect(patch).toMatchObject({ title: 'T', tags: ['a', 'b'], cast: '{{user}} — a keeper\nOld Ann — a witch', twists: 'One\nTwo' });
    expect(patch.beats?.map((b) => b.title || b.text)).toEqual(['Storm', 'Plain beat']);
    expect('synopsis' in patch).toBe(false);
  });

  it('reads ideas in object, array and string forms', () => {
    expect(parseIdeas({ ideas: [{ title: 'A', pitch: 'p', tags: ['x'] }, 'bare idea', { title: 'empty' }] }, true)).toMatchObject([
      { title: 'A', logline: 'p', tags: ['x'], nsfw: true },
      { title: '', logline: 'bare idea' },
    ]);
    expect(parseIdeas([{ name: 'B', logline: 'l' }], false)[0]).toMatchObject({ title: 'B', nsfw: false });
  });

  it('lists only the empty parts', () => {
    const parts = emptyPlotParts(plot);
    expect(parts).toEqual(['cast', 'synopsis', 'twists']);
    expect(emptyPlotParts(emptyPlot())).toContain('beats');
  });

  it('exports Markdown and a scenario card', () => {
    const md = plotToMarkdown(plot, labels);
    expect(md).toContain('# Маяк');
    expect(md).toContain('> Смотритель встречает себя из будущего.');
    expect(md).toContain('### 1. Шторм');
    expect(md).not.toContain('## Cast');
    const card = plotToCard(plot, labels);
    expect(card).toMatchObject({ name: 'Маяк', scenario: plot.logline, first_mes: 'Фонарь мигнул.', tags: ['mystery', 'nsfw'] });
    expect(card.description).toContain('## Scenes\n1. Шторм — Лодка разбивается о скалы.');
  });

  it('switches the content mode and hides adult genres in SFW', () => {
    const [off] = plotNew('idea', 6, { ...sfw, genres: [...sfw.genres] }, {}, common);
    expect(off.content).toContain('Content mode: SFW');
    expect(off.content).not.toContain('erotica');
    expect(off.content).toContain('mystery / detective');
    const [on] = plotNew('idea', 6, { ...sfw, genres: [...sfw.genres], nsfw: true }, {}, common);
    expect(on.content).toContain('Content mode: NSFW');
    expect(on.content).toContain('erotica');
    expect(on.content).toContain('every character in sexual or sexualized content is an adult');
  });

  it('passes library context and the ideas already on the board', () => {
    const ch = { ...emptyCharacter('Мирей'), description: 'Часовщица.' };
    const [, user] = plotIdeas('', 4, ['Old idea'], { ...sfw, genres: [] }, { character: ch }, common);
    expect(user.content).toContain('({{char}})');
    expect(user.content).toContain('Часовщица.');
    expect(user.content).toContain('- Old idea');
    expect(user.content).toContain('USER-RULE');
  });

  it('writes a first message or a new alternate greeting from a plot', () => {
    const ch = { ...emptyCharacter('Мирей'), description: 'Часовщица.', first_mes: 'Старое приветствие.' };
    const [sys, user] = charGreeting(ch, plotSource(plot), 'first', 'ночью', false, common);
    expect(sys.content).toContain('the first message (greeting)');
    expect(sys.content).toContain('Content mode: SFW');
    expect(user.content).toContain('"title": "Маяк"');
    expect(user.content).toContain('Старое приветствие.');
    expect(user.content).toContain('# Extra idea\nночью');
    const [alt] = charGreeting(ch, '# Мой сюжет\nтекст', 'alt', '', true, common);
    expect(alt.content).toContain('new alternate greeting');
    expect(alt.content).toContain('Content mode: NSFW');
  });

  it('cuts a long greeting source', () => {
    const [, user] = charGreeting(emptyCharacter('A'), 'x'.repeat(GREET_SOURCE_MAX + 500), 'first', '', false, common);
    expect(user.content).toContain('x'.repeat(GREET_SOURCE_MAX) + '…');
    expect(user.content).not.toContain('x'.repeat(GREET_SOURCE_MAX + 1));
  });

  it('asks only for the missing parts when filling', () => {
    const [sys] = plotFill(plot, ['cast', 'beats'], '', 5, { ...sfw, genres: [] }, {}, common);
    expect(sys.content).toContain('Return only these keys: cast, beats.');
    expect(sys.content).toContain('{"cast":"string","beats":[{"title":"string","text":"string"}]}');
  });
});
