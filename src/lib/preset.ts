import { isObj, num, str } from './json';
import type { Mini, PresetBlock, PresetDoc, Role } from './types';
import { uid } from './util';

/** SillyTavern built-in markers: slots the app fills with card / chat content. */
export const ST_MARKERS = [
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
] as const;
export type MarkerId = (typeof ST_MARKERS)[number];

const MARKER_LABEL: Record<MarkerId, string> = {
  worldInfoBefore: 'World Info (before)',
  personaDescription: 'Persona Description',
  charDescription: 'Char Description',
  charPersonality: 'Char Personality',
  scenario: 'Scenario',
  worldInfoAfter: 'World Info (after)',
  dialogueExamples: 'Chat Examples',
  chatHistory: 'Chat History',
};

const BUILTIN_TEXT = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];

export const isMarkerId = (s: string): s is MarkerId => (ST_MARKERS as readonly string[]).includes(s);

export function newBlock(p: Partial<PresetBlock> = {}): PresetBlock {
  return {
    id: uid(),
    identifier: uid(),
    name: '',
    marker: false,
    role: 'system',
    content: '',
    enabled: true,
    position: 0,
    depth: 4,
    order: 100,
    minis: [],
    ...p,
  };
}

function markerBlock(m: MarkerId, enabled = true): PresetBlock {
  return newBlock({ identifier: m, name: MARKER_LABEL[m], marker: true, enabled });
}

/** Default SillyTavern Chat Completion settings for new presets. */
export function defaultPresetSettings(): Record<string, unknown> {
  return {
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 0.95,
    top_k: 0,
    top_a: 0,
    min_p: 0,
    repetition_penalty: 1,
    openai_max_context: 32768,
    openai_max_tokens: 800,
    max_context_unlocked: true,
    names_behavior: 0,
    send_if_empty: '',
    impersonation_prompt:
      "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",
    new_chat_prompt: '[Start a new Chat]',
    new_group_chat_prompt: '[Start a new group chat. Group members: {{group}}]',
    new_example_chat_prompt: '[Example Chat]',
    continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
    bias_preset_selected: 'Default (none)',
    wi_format: '{0}',
    scenario_format: '{{scenario}}',
    personality_format: '{{personality}}',
    group_nudge_prompt: '[Write the next reply only as {{char}}.]',
    stream_openai: true,
    assistant_prefill: '',
    assistant_impersonation: '',
    use_sysprompt: false,
    squash_system_messages: false,
    continue_prefill: false,
    continue_postfix: ' ',
    seed: -1,
    n: 1,
  };
}

export function emptyPreset(name: string): PresetDoc {
  return {
    id: uid(),
    name,
    blocks: [
      newBlock({ identifier: 'main', name: 'Main Prompt' }),
      markerBlock('worldInfoBefore'),
      markerBlock('personaDescription'),
      markerBlock('charDescription'),
      markerBlock('charPersonality'),
      markerBlock('scenario'),
      markerBlock('worldInfoAfter'),
      markerBlock('dialogueExamples'),
      markerBlock('chatHistory'),
    ],
    raw: defaultPresetSettings(),
    updatedAt: Date.now(),
  };
}

/** Text that actually goes to the model: mini-instructions when the block was split, otherwise the content. */
export const blockText = (b: PresetBlock) => (b.minis.length ? miniText(b.minis) : b.content);
export const miniText = (minis: Mini[]) => minis.map((m, i) => `${i + 1}. ${m.text.trim()}`).join('\n');

export class PresetImportError extends Error {}

interface STPrompt {
  identifier: string;
  name?: string;
  system_prompt?: boolean;
  marker?: boolean;
  role?: Role;
  content?: string;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  enabled?: boolean;
  lace_forge?: { content?: string; minis?: string[] };
  [k: string]: unknown;
}

interface OrderEntry {
  identifier: string;
  enabled: boolean;
}

export function importPreset(text: string, fileName: string): PresetDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetImportError('json');
  }
  if (!isObj(data) || !Array.isArray(data.prompts)) throw new PresetImportError('not-preset');
  const { prompts: rawPrompts, prompt_order, ...rest } = data;
  const prompts = (rawPrompts as unknown[]).filter((p): p is STPrompt => isObj(p) && typeof p.identifier === 'string');
  const byId = new Map(prompts.map((p) => [p.identifier, p]));
  const orders = Array.isArray(prompt_order) ? (prompt_order as { character_id: number; order: OrderEntry[] }[]).filter((o) => isObj(o) && Array.isArray(o.order)) : [];
  const chosen = orders.find((o) => o.character_id === 100001) ?? orders.find((o) => o.character_id === 100000) ?? orders[0];
  const order: OrderEntry[] = chosen?.order ?? prompts.map((p) => ({ identifier: p.identifier, enabled: p.enabled ?? true }));

  const blocks: PresetBlock[] = [];
  const seen = new Set<string>();
  const push = (p: STPrompt, enabled: boolean) => {
    if (seen.has(p.identifier)) return;
    seen.add(p.identifier);
    const marker = !!p.marker || isMarkerId(p.identifier);
    const { lace_forge, ...rawPrompt } = p;
    const minis = Array.isArray(lace_forge?.minis) ? lace_forge.minis.map((t) => ({ id: uid(), text: String(t) })) : [];
    blocks.push(
      newBlock({
        identifier: p.identifier,
        name: str(p.name) || (isMarkerId(p.identifier) ? MARKER_LABEL[p.identifier] : p.identifier),
        marker,
        role: p.role === 'user' || p.role === 'assistant' ? p.role : 'system',
        content: minis.length && typeof lace_forge?.content === 'string' ? lace_forge.content : str(p.content),
        enabled,
        position: p.injection_position === 1 ? 1 : 0,
        depth: num(p.injection_depth, 4),
        order: num(p.injection_order, 100),
        minis,
        raw: rawPrompt,
      }),
    );
  };
  for (const o of order) {
    const p = byId.get(o.identifier);
    if (p) push(p, o.enabled !== false);
  }
  // Prompts missing from the order are kept (disabled) so nothing is lost.
  for (const p of prompts) {
    if (seen.has(p.identifier)) continue;
    if (!str(p.content).trim() && (BUILTIN_TEXT.includes(p.identifier) || p.marker)) continue;
    push(p, false);
  }
  return {
    id: uid(),
    name: fileName.replace(/\.json$/i, '') || 'Preset',
    blocks,
    raw: rest,
    orderId: chosen?.character_id,
    updatedAt: Date.now(),
  };
}

export function toSillyTavern(doc: PresetDoc): Record<string, unknown> & { prompts: STPrompt[]; prompt_order: { character_id: number; order: OrderEntry[] }[] } {
  const prompts: STPrompt[] = [];
  const order: OrderEntry[] = [];
  const used = new Set<string>();
  for (const b of doc.blocks) {
    let id = b.identifier || uid();
    while (used.has(id)) id = uid();
    used.add(id);
    if (b.marker) {
      prompts.push({ ...(b.raw ?? {}), identifier: id, name: b.name, system_prompt: true, marker: true });
    } else {
      const p: STPrompt = {
        ...(b.raw ?? {}),
        identifier: id,
        name: b.name,
        system_prompt: (b.raw?.system_prompt as boolean | undefined) ?? BUILTIN_TEXT.includes(id),
        marker: false,
        role: b.role,
        content: blockText(b),
        injection_position: b.position,
        injection_depth: b.depth,
        injection_order: b.order,
        forbid_overrides: (b.raw?.forbid_overrides as boolean | undefined) ?? false,
      };
      if (b.minis.length) p.lace_forge = { content: b.content, minis: b.minis.map((m) => m.text) };
      prompts.push(p);
    }
    order.push({ identifier: id, enabled: b.enabled });
  }
  // ST expects its built-in slots to exist.
  for (const m of ST_MARKERS) {
    if (used.has(m)) continue;
    prompts.push({ identifier: m, name: MARKER_LABEL[m], system_prompt: true, marker: true });
    order.push({ identifier: m, enabled: m === 'chatHistory' });
  }
  for (const id of BUILTIN_TEXT) {
    if (used.has(id)) continue;
    prompts.push({ identifier: id, name: id, system_prompt: true, marker: false, role: 'system', content: '' });
  }
  return {
    ...defaultPresetSettings(),
    ...(doc.raw ?? {}),
    prompts,
    prompt_order: [
      { character_id: 100000, order },
      { character_id: 100001, order },
    ],
  };
}

/** Rough text of the whole enabled preset, for context in AI requests. */
export function presetOutline(doc: PresetDoc, skipId?: string, maxChars = 6000) {
  const parts: string[] = [];
  for (const b of doc.blocks) {
    if (b.id === skipId) continue;
    if (b.marker) {
      parts.push(`[marker: ${b.identifier}]`);
      continue;
    }
    if (!b.enabled) continue;
    parts.push(`### ${b.name}\n${blockText(b).slice(0, 900)}`);
  }
  const s = parts.join('\n\n');
  return s.length > maxChars ? s.slice(0, maxChars) + '\n…' : s;
}
