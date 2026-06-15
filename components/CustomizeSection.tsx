"use client";

import { useState } from "react";
import type { Mood } from "@/lib/types";
import MoodSelector from "./MoodSelector";
import AdventurousnessSlider from "./AdventurousnessSlider";

type CustomizeSectionProps = {
  moods: Mood[];
  onToggleMood: (mood: Mood) => void;
  adventurousness: number;
  onAdventurousnessChange: (value: number) => void;
};

export default function CustomizeSection({
  moods,
  onToggleMood,
  adventurousness,
  onAdventurousnessChange,
}: CustomizeSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="customize-panel"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-neon"
      >
        <span
          aria-hidden
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        Customize further
      </button>

      <div
        id="customize-panel"
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-6 pt-4">
            <MoodSelector moods={moods} onToggle={onToggleMood} />
            <AdventurousnessSlider
              value={adventurousness}
              onChange={onAdventurousnessChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
