import type { SampleInfo } from "./types";

/** CC0 / 免费可商用 Techno 采样来源目录 */
export const FREE_SAMPLE_SOURCES = [
  {
    name: "Freesound.org",
    url: "https://freesound.org/search/?q=techno+kick&f=license:%22Creative+Commons+0%22",
    license: "CC0",
  },
  {
    name: "Looperman",
    url: "https://www.looperman.com/loops/tags/free-techno-loops-samples-sounds-wavs-download",
    license: "Royalty Free (check per pack)",
  },
  {
    name: "Sample Focus",
    url: "https://samplefocus.com/tag/techno",
    license: "Free tier",
  },
  {
    name: "99Sounds",
    url: "https://99sounds.org/free-samples/",
    license: "Royalty Free",
  },
];

/** 内置采样 — 使用 Tone.js 合成 + 部分 CDN 采样 */
export const SAMPLE_CATALOG: SampleInfo[] = [
  {
    id: "kick-909",
    name: "909 Kick",
    category: "kick",
    source: "Synthesized (909-style)",
    url: "",
    license: "Built-in",
  },
  {
    id: "bass-analog",
    name: "Analog Bass",
    category: "bass",
    source: "Synthesized (MonoSynth)",
    url: "",
    license: "Built-in",
  },
  {
    id: "hat-closed",
    name: "Closed Hi-Hat",
    category: "hat",
    source: "Synthesized (Noise)",
    url: "",
    license: "Built-in",
  },
  {
    id: "lead-saw",
    name: "Saw Lead",
    category: "lead",
    source: "Synthesized (Synth)",
    url: "",
    license: "Built-in",
  },
  {
    id: "pad-warm",
    name: "Warm Pad",
    category: "pad",
    source: "Synthesized (PolySynth)",
    url: "",
    license: "Built-in",
  },
];
