"use client";

import { useEffect, useRef, useState } from "react";
import type { PivotDirection } from "@/lib/deck";
import type { Mood } from "@/lib/types";
import MoodSelector from "./MoodSelector";

type PivotPromptProps = {
  open: boolean;
  /** Dislikes in the round just finished, and how many cards it held. */
  disliked: number;
  total: number;
  /** The last direction the user picked came back with nothing. */
  failed: boolean;
  moods: Mood[];
  onToggleMood: (mood: Mood) => void;
  onChoose: (direction: PivotDirection) => void;
  onShowMap: () => void;
};

/**
 * The fork in the road after a round the user mostly rejected.
 *
 * A wall of dislikes says "not these" but not *which way* to go — obscurer or
 * safer are opposite moves and the swipes can't distinguish them. So rather than
 * guessing a direction and spending a round on it, we ask.
 *
 * A native <dialog> + showModal(), matching ArtistSongsDialog: focus trapping,
 * focus restoration and top-layer stacking for free. Top-layer matters here
 * because this has to paint over a SwipeDeck that stays mounted underneath —
 * unmounting the deck would reset its card index and replay the whole round.
 *
 * Escape maps to "show my map" rather than to nothing: it's the one exit that
 * loses no work, and it's on screen as a button too, so the gesture and the
 * visible affordance agree.
 */
export default function PivotPrompt({
  open,
  disliked,
  total,
  failed,
  moods,
  onToggleMood,
  onChoose,
  onShowMap,
}: PivotPromptProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pickingMood, setPickingMood] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      // Always open on the direction choices. The mood sub-view is a detour
      // within one visit, not a preference that should outlive it.
      setPickingMood(false);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Escape is a close *request*; route it to the one choice that loses no
      // work rather than letting the browser close a dialog the flow still
      // believes is open.
      onCancel={(event) => {
        event.preventDefault();
        onShowMap();
      }}
      aria-labelledby="pivot-heading"
      className="m-auto w-[min(30rem,90vw)] max-h-[85dvh] overflow-y-auto rounded-2xl border-2 border-neon bg-bg-elevated p-6 text-left backdrop:bg-black/70"
    >
      <h3 id="pivot-heading" className="text-lg font-bold text-neon">
        Not feeling these?
      </h3>
      <p className="mt-1 text-sm text-muted">
        You passed on {disliked} of {total}. Where should we look instead?
      </p>

      {failed && (
        <p role="status" className="mt-3 text-sm text-danger">
          That direction came up empty — try another.
        </p>
      )}

      {pickingMood ? (
        <div className="mt-5">
          <MoodSelector moods={moods} onToggle={onToggleMood} />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => onChoose("vibe")}
              className="flex-1 cursor-pointer rounded-xl bg-neon px-4 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
            >
              Find more like this
            </button>
            <button
              type="button"
              onClick={() => setPickingMood(false)}
              className="cursor-pointer rounded-xl border border-neon/30 px-4 py-3 text-sm text-muted transition-colors hover:border-neon/60 hover:text-neon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <PivotChoice
            label="Deeper, lesser-known"
            hint="Reach further out for artists fewer people have found."
            onClick={() => onChoose("obscure")}
          />
          <PivotChoice
            label="More familiar"
            hint="Stay closer to home with better-known names."
            onClick={() => onChoose("familiar")}
          />
          <PivotChoice
            label="Different vibe…"
            hint="Same reach, different mood."
            onClick={() => setPickingMood(true)}
          />
          <button
            type="button"
            onClick={onShowMap}
            className="mt-1 cursor-pointer rounded-xl px-4 py-2 text-sm text-muted transition-colors hover:text-neon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
          >
            Just show my taste map
          </button>
        </div>
      )}
    </dialog>
  );
}

function PivotChoice({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-neon/25 px-4 py-3 text-left transition-colors hover:border-neon hover:bg-neon/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
    >
      <span className="block font-semibold text-neon">{label}</span>
      <span className="mt-0.5 block text-xs text-muted">{hint}</span>
    </button>
  );
}
