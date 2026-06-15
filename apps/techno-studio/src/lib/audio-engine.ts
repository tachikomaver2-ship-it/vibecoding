"use client";

import type { CompositionState } from "./types";
import { getNoteName } from "./prompt-parser";

type ToneModule = typeof import("tone");

let toneModule: ToneModule | null = null;
let kick: InstanceType<ToneModule["MembraneSynth"]> | null = null;
let bass: InstanceType<ToneModule["MonoSynth"]> | null = null;
let hat: InstanceType<ToneModule["NoiseSynth"]> | null = null;
let lead: InstanceType<ToneModule["Synth"]> | null = null;
let pad: InstanceType<ToneModule["PolySynth"]> | null = null;
let bassDistortion: InstanceType<ToneModule["Distortion"]> | null = null;
let masterReverb: InstanceType<ToneModule["Reverb"]> | null = null;
let masterLimiter: InstanceType<ToneModule["Limiter"]> | null = null;

let kickLoop: InstanceType<ToneModule["Loop"]> | null = null;
let bassLoop: InstanceType<ToneModule["Loop"]> | null = null;
let hatLoop: InstanceType<ToneModule["Loop"]> | null = null;
let leadLoop: InstanceType<ToneModule["Loop"]> | null = null;
let padLoop: InstanceType<ToneModule["Loop"]> | null = null;

let currentState: CompositionState | null = null;
let initialized = false;
let playing = false;

async function getTone(): Promise<ToneModule> {
  if (!toneModule) {
    toneModule = await import("tone");
  }
  return toneModule;
}

async function ensureInit() {
  if (initialized) return;
  const Tone = await getTone();
  await Tone.start();

  masterLimiter = new Tone.Limiter(-1).toDestination();
  masterReverb = new Tone.Reverb({ decay: 4, wet: 0 }).connect(masterLimiter);
  bassDistortion = new Tone.Distortion(0).connect(masterReverb);

  kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
  }).connect(masterReverb);

  bass = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.8 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 2, baseFrequency: 200, octaves: 2.6 },
  }).connect(bassDistortion);

  hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
  }).connect(masterReverb);
  hat.volume.value = -12;

  lead = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.3 },
  }).connect(masterReverb);
  lead.volume.value = -6;

  pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 2 },
  }).connect(masterReverb);
  pad.volume.value = -14;

  initialized = true;
}

function disposeLoops(Tone: ToneModule) {
  [kickLoop, bassLoop, hatLoop, leadLoop, padLoop].forEach((loop) => {
    loop?.stop();
    loop?.dispose();
  });
  kickLoop = bassLoop = hatLoop = leadLoop = padLoop = null;
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
}

function applyEffects(state: CompositionState) {
  if (masterReverb) masterReverb.wet.value = state.effects.reverb;
  if (bassDistortion) bassDistortion.distortion = state.effects.distortion;
  if (bass) {
    bass.volume.value = state.effects.bassPower > 0 ? 0 : -3;
  }
}

function buildLoops(state: CompositionState, Tone: ToneModule) {
  disposeLoops(Tone);

  const effectiveBpm = state.bpm * state.speedMultiplier;
  Tone.getTransport().bpm.value = effectiveBpm;

  const step = state.effects.drop ? "8n" : "4n";
  const pattern = state.pattern.length > 0 ? state.pattern : [0, 1, 2, 3];
  let stepIndex = 0;

  if (state.layers.kick.enabled && kick) {
    kickLoop = new Tone.Loop((time) => {
      kick!.triggerAttackRelease(state.effects.drop ? "C1" : "C1", "8n", time);
      if (state.effects.drop && stepIndex % 2 === 0) {
        kick!.triggerAttackRelease("C0", "16n", time + Tone.Time("16n").toSeconds());
      }
    }, step).start(0);
  }

  if (state.layers.bass.enabled && bass) {
    bassLoop = new Tone.Loop((time) => {
      const note = getNoteName(pattern[stepIndex % pattern.length]);
      bass!.triggerAttackRelease(note, "8n", time);
    }, "4n").start(0);
  }

  if (state.layers.hat.enabled && hat) {
    hatLoop = new Tone.Loop((time) => {
      hat!.triggerAttackRelease("8n", time);
    }, "8n").start("8n");
  }

  if (state.layers.lead.enabled && lead) {
    leadLoop = new Tone.Loop((time) => {
      const note = getNoteName(pattern[stepIndex % pattern.length]);
      const octave = state.speedMultiplier >= 2 ? 4 : 3;
      lead!.triggerAttackRelease(note.replace(/\d/, String(octave)), "16n", time);
      stepIndex++;
    }, state.speedMultiplier >= 2 ? "8n" : "4n").start(0);
  }

  if (state.layers.pad.enabled && pad) {
    const root = getNoteName(pattern[0]);
    padLoop = new Tone.Loop((time) => {
      pad!.triggerAttackRelease([root, getNoteName((pattern[0] + 2) % 8)], "2n", time);
    }, "1m").start(0);
  }

  applyEffects(state);
}

export async function playComposition(state: CompositionState) {
  await ensureInit();
  const Tone = await getTone();

  if (playing && currentState) {
    disposeLoops(Tone);
  }

  currentState = state;
  buildLoops(state, Tone);
  Tone.getTransport().start();
  playing = true;
}

export async function stopComposition() {
  if (!initialized || !toneModule) return;
  disposeLoops(toneModule);
  playing = false;
}

export function isPlaying() {
  return playing;
}

export async function updateComposition(state: CompositionState) {
  currentState = state;
  if (playing) {
    await playComposition(state);
  }
}
