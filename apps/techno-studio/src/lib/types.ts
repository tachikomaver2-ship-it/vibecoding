export type LayerId = "kick" | "bass" | "hat" | "lead" | "pad";

export interface LayerState {
  id: LayerId;
  enabled: boolean;
  volume: number;
  label: string;
  color: string;
}

export interface EffectState {
  reverb: number;
  distortion: number;
  bassPower: number;
  drop: boolean;
}

export interface CompositionState {
  bpm: number;
  noteCount: number;
  speedMultiplier: number;
  pattern: number[];
  layers: Record<LayerId, LayerState>;
  effects: EffectState;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  snapshot?: CompositionState;
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
}

export interface Post {
  id: string;
  title: string;
  author: string;
  composition: CompositionState;
  likes: number;
  likedBy: string[];
  comments: Comment[];
  shares: number;
  createdAt: number;
}

export interface PromptResult {
  reply: string;
  changes: string[];
  state: CompositionState;
}

export interface SampleInfo {
  id: string;
  name: string;
  category: LayerId;
  source: string;
  url: string;
  license: string;
}
