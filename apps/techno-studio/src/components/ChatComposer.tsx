"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, CompositionState } from "@/lib/types";
import { parsePrompt, createInitialState } from "@/lib/prompt-parser";
import { playComposition, stopComposition } from "@/lib/audio-engine";
import TrackStack from "./TrackStack";

const DEMO_FLOW = [
  "127bpm, give me 4 notes",
  "double it",
  "put it in big hall",
  "powerful bass",
  "distort bass",
  "drop",
  "kick drum",
];

interface ChatComposerProps {
  onPublish?: (state: CompositionState) => void;
  initialState?: CompositionState;
  readOnly?: boolean;
}

export default function ChatComposer({
  onPublish,
  initialState,
  readOnly = false,
}: ChatComposerProps) {
  const [state, setState] = useState<CompositionState>(
    initialState ?? createInitialState()
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "欢迎来到 TechnoStudio 🎧\n\n用自然语言描述你想要的编曲，我会逐步叠加采样和效果。\n\n试试：127bpm, give me 4 notes",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [playing, setPlaying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (initialState) setState(initialState);
  }, [initialState]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || readOnly) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    const result = parsePrompt(input.trim(), state);
    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: result.reply,
      timestamp: Date.now(),
      snapshot: result.state,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setState(result.state);
    setInput("");

    if (playing) {
      await playComposition(result.state);
    }
  }

  async function togglePlay() {
    if (playing) {
      await stopComposition();
      setPlaying(false);
    } else {
      await playComposition(state);
      setPlaying(true);
    }
  }

  async function runDemo() {
    if (readOnly) return;
    let current = createInitialState();
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "开始 Demo 编曲流程…",
        timestamp: Date.now(),
      },
    ]);

    for (const prompt of DEMO_FLOW) {
      await new Promise((r) => setTimeout(r, 900));
      const result = parsePrompt(prompt, current);
      current = result.state;

      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: prompt, timestamp: Date.now() },
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: result.reply,
          timestamp: Date.now(),
          snapshot: result.state,
        },
      ]);
      setState(current);
      await playComposition(current);
      setPlaying(true);
    }
  }

  async function handlePublish() {
    if (!onPublish || readOnly) return;
    setPublishing(true);
    try {
      await onPublish(state);
    } finally {
      setPublishing(false);
    }
  }

  const layers = Object.values(state.layers);
  const effects = [
    state.effects.reverb > 0 && `Reverb ${Math.round(state.effects.reverb * 100)}%`,
    state.effects.distortion > 0 && `Distortion ${Math.round(state.effects.distortion * 100)}%`,
    state.effects.bassPower > 0 && "Power Bass",
    state.effects.drop && "DROP",
  ].filter(Boolean);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Chat */}
      <div className="flex flex-col lg:col-span-3">
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/5 bg-zinc-900/60 p-4"
          style={{ minHeight: 360, maxHeight: 480 }}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-gradient-to-br from-cyan-600 to-fuchsia-600 text-white"
                    : "bg-zinc-800 text-zinc-200"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        {!readOnly && (
          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="127bpm, give me 4 notes / double it / distort bass..."
              className="flex-1 rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
            />
            <button
              type="submit"
              className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              发送
            </button>
          </form>
        )}
      </div>

      {/* Side panel */}
      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-white/5 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-300">当前编曲</h3>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-cyan-400">
              {state.bpm} BPM ×{state.speedMultiplier}
            </span>
          </div>

          <TrackStack layers={layers} />

          {effects.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {effects.map((fx) => (
                <span
                  key={fx as string}
                  className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-xs text-fuchsia-300 ring-1 ring-fuchsia-500/20"
                >
                  {fx}
                </span>
              ))}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={togglePlay}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                playing
                  ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/30"
                  : "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white hover:opacity-90"
              }`}
            >
              {playing ? "⏹ 停止" : "▶ 试听"}
            </button>
            <button
              onClick={runDemo}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              Demo
            </button>
            {onPublish && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-medium text-zinc-200 ring-1 ring-white/10 hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                {publishing ? "发布中…" : "🚀 发布到编曲区"}
              </button>
            )}
          </div>
        )}

        {readOnly && (
          <button
            onClick={togglePlay}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {playing ? "⏹ 停止" : "▶ 播放"}
          </button>
        )}
      </div>
    </div>
  );
}
