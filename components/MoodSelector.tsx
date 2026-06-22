"use client";

import { MOODS, type Mood } from "@/lib/types";

type MoodSelectorProps = {
  moods: Mood[];
  onToggle: (mood: Mood) => void;
};

export default function MoodSelector({ moods, onToggle }: MoodSelectorProps) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-muted">Mood</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MOODS.map((mood) => {
          const selected = moods.includes(mood);
          return (
            <button
              key={mood}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(mood)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm capitalize cursor-pointer transition-colors ${
                selected
                  ? "border-neon bg-neon/15 text-neon"
                  : "border-neon/20 text-muted hover:border-neon/50"
              }`}
            >
              {mood}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
