import type { CompositionState, LayerId, LayerState, PromptResult } from "./types";

const NOTE_NAMES = ["C", "Eb", "G", "Bb", "D", "F", "A", "C5"];

function createLayer(
  id: LayerId,
  label: string,
  color: string,
  enabled = false
): LayerState {
  return { id, label, color, enabled, volume: id === "bass" ? 0.8 : 0.7 };
}

export function createInitialState(): CompositionState {
  return {
    bpm: 128,
    noteCount: 0,
    speedMultiplier: 1,
    pattern: [],
    title: "Untitled Techno",
    layers: {
      kick: createLayer("kick", "Kick Drum", "#ff3366"),
      bass: createLayer("bass", "Bass", "#00ffcc"),
      hat: createLayer("hat", "Hi-Hat", "#ffcc00"),
      lead: createLayer("lead", "Lead", "#cc66ff"),
      pad: createLayer("pad", "Pad", "#6699ff"),
    },
    effects: {
      reverb: 0,
      distortion: 0,
      bassPower: 0,
      drop: false,
    },
  };
}

function generatePattern(count: number): number[] {
  const pattern: number[] = [];
  for (let i = 0; i < count; i++) {
    pattern.push(i % 4);
  }
  return pattern;
}

function cloneState(state: CompositionState): CompositionState {
  return JSON.parse(JSON.stringify(state)) as CompositionState;
}

export function parsePrompt(
  prompt: string,
  state: CompositionState
): PromptResult {
  const next = cloneState(state);
  const changes: string[] = [];
  const lower = prompt.toLowerCase().trim();

  const bpmMatch = lower.match(/(\d{2,3})\s*bpm/);
  if (bpmMatch) {
    next.bpm = Math.min(180, Math.max(80, parseInt(bpmMatch[1], 10)));
    changes.push(`BPM 设为 ${next.bpm}`);
  }

  const notesMatch = lower.match(
    /give me (\d+) notes?|(\d+) notes?|来(\d+)个音/
  );
  if (notesMatch) {
    const count = parseInt(notesMatch[1] || notesMatch[2] || notesMatch[3], 10);
    next.noteCount = Math.min(8, Math.max(1, count));
    next.pattern = generatePattern(next.noteCount);
    next.layers.lead.enabled = true;
    changes.push(`生成 ${next.noteCount} 个音符序列: ${formatPattern(next.pattern)}`);
  }

  if (/double it|双倍|加快|x2|两倍/.test(lower)) {
    next.speedMultiplier = Math.min(4, next.speedMultiplier * 2);
    changes.push(`节奏加速 ${next.speedMultiplier}x`);
  }

  if (/big hall|大混响|hall|reverb|混响/.test(lower)) {
    next.effects.reverb = 0.85;
    changes.push("添加 Big Hall 混响");
  }

  if (/powerful bass|heavy bass|强力贝斯|power bass/.test(lower)) {
    next.layers.bass.enabled = true;
    next.effects.bassPower = 1;
    next.layers.bass.volume = 1;
    changes.push("启用 Powerful Bass");
  }

  if (/distort.*bass|bass.*distort|失真贝斯|distortion/.test(lower)) {
    next.layers.bass.enabled = true;
    next.effects.distortion = 0.75;
    changes.push("Bass 添加 Distortion 失真");
  }

  if (/\bdrop\b|掉落|drop it/.test(lower)) {
    next.effects.drop = true;
    next.layers.kick.enabled = true;
    next.layers.bass.enabled = true;
    changes.push("Drop 段落 — Kick + Bass 全力输出");
  }

  if (/kick|底鼓|鼓点/.test(lower)) {
    next.layers.kick.enabled = true;
    changes.push("叠加 Kick Drum 层");
  }

  if (/hi.?hat|hat|踩镲/.test(lower)) {
    next.layers.hat.enabled = true;
    changes.push("叠加 Hi-Hat 层");
  }

  if (/bass|贝斯/.test(lower) && !/distort|powerful|heavy/.test(lower)) {
    next.layers.bass.enabled = true;
    changes.push("叠加 Bass 层");
  }

  if (/pad|氛围|pad synth/.test(lower)) {
    next.layers.pad.enabled = true;
    next.effects.reverb = Math.max(next.effects.reverb, 0.5);
    changes.push("叠加 Pad 氛围层");
  }

  if (/slow|half|减半|慢一半/.test(lower)) {
    next.speedMultiplier = Math.max(0.5, next.speedMultiplier / 2);
    changes.push(`节奏减速至 ${next.speedMultiplier}x`);
  }

  if (/reset|重置|清空/.test(lower)) {
    const fresh = createInitialState();
    return {
      reply: "已重置编曲，从头开始。试试：127bpm, give me 4 notes",
      changes: ["重置所有轨道与效果"],
      state: fresh,
    };
  }

  const titleMatch = prompt.match(/(?:title|标题)[：:]\s*(.+)/i);
  if (titleMatch) {
    next.title = titleMatch[1].trim();
    changes.push(`标题设为「${next.title}」`);
  }

  const reply = buildReply(changes, next);
  return { reply, changes, state: next };
}

function formatPattern(pattern: number[]): string {
  return pattern.map((i) => NOTE_NAMES[i % NOTE_NAMES.length]).join(" → ");
}

function buildReply(changes: string[], state: CompositionState): string {
  if (changes.length === 0) {
    return [
      "没识别到具体指令，你可以试试：",
      "• 127bpm, give me 4 notes",
      "• double it",
      "• put it in big hall / powerful bass / distort bass",
      "• drop / kick drum",
    ].join("\n");
  }

  const activeLayers = Object.values(state.layers)
    .filter((l) => l.enabled)
    .map((l) => l.label)
    .join(" + ");

  const effectParts: string[] = [];
  if (state.effects.reverb > 0) effectParts.push(`Reverb ${Math.round(state.effects.reverb * 100)}%`);
  if (state.effects.distortion > 0) effectParts.push(`Distortion ${Math.round(state.effects.distortion * 100)}%`);
  if (state.effects.bassPower > 0) effectParts.push("Power Bass");
  if (state.effects.drop) effectParts.push("DROP");

  const lines = [
    `✓ ${changes.join(" · ")}`,
    "",
    `当前: ${state.bpm} BPM × ${state.speedMultiplier} | ${state.noteCount || "—"} notes`,
  ];

  if (state.pattern.length > 0) {
    lines.push(`序列: ${formatPattern(state.pattern)}`);
  }
  if (activeLayers) {
    lines.push(`轨道: ${activeLayers}`);
  }
  if (effectParts.length > 0) {
    lines.push(`效果: ${effectParts.join(" · ")}`);
  }

  lines.push("", "继续描述或按 ▶ 试听当前编曲");
  return lines.join("\n");
}

export function getNoteName(index: number): string {
  const octave = index >= 4 ? 3 : 2;
  return `${NOTE_NAMES[index % NOTE_NAMES.length]}${octave}`;
}

export { NOTE_NAMES };
