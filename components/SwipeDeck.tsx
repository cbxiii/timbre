"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { RecommendedSongWithDesc, Verdict } from "@/lib/types";
import SongCard, { SWIPE_THRESHOLD } from "./SongCard";

type SwipeDeckProps = {
  songs: RecommendedSongWithDesc[];
  /** Verdicts recorded so far, owned by SwipeFlow (the taste map needs them). */
  verdicts: Map<string, Verdict>;
  onVerdict: (song: RecommendedSongWithDesc, verdict: Verdict) => void;
  onFinished: () => void;
  /**
   * Shown once the deck runs dry. SwipeFlow may append another round rather than
   * ending here, so what "out of cards" means is its call, not ours.
   */
  doneMessage?: string;
};

const EXIT_MS = 300;

export default function SwipeDeck({
  songs,
  verdicts,
  onVerdict,
  onFinished,
  doneMessage = "Building your taste map…",
}: SwipeDeckProps) {
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  // When true, the card animates (snap-back or fly-off); during a live drag we
  // want the card to track the pointer with no transition lag.
  const [transitioning, setTransitioning] = useState(false);

  const startX = useRef(0);
  const dragging = useRef(false);

  const current = songs[index];
  const done = index >= songs.length;

  // Hand the deck off to SwipeFlow from an effect, not from render — calling a
  // parent's setter during render is not allowed.
  useEffect(() => {
    if (done) onFinished();
  }, [done, onFinished]);

  let liked = 0;
  let disliked = 0;
  for (const verdict of verdicts.values()) {
    if (verdict === "like") liked++;
    else disliked++;
  }

  // Record the like/dislike, fling the card off-screen, then advance once the
  // exit animation finishes. Both the buttons and a committed drag call this.
  function commit(direction: Verdict) {
    if (transitioning || done) return;
    onVerdict(songs[index], direction);

    dragging.current = false;
    setTransitioning(true);
    setDragX(direction === "like" ? window.innerWidth : -window.innerWidth);

    setTimeout(() => {
      setIndex((i) => i + 1);
      setDragX(0);
      setTransitioning(false);
    }, EXIT_MS);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (transitioning) return;
    dragging.current = true;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setDragX(e.clientX - startX.current);
  }

  function handlePointerUp() {
    if (!dragging.current) return;
    dragging.current = false;

    if (Math.abs(dragX) > SWIPE_THRESHOLD) {
      commit(dragX > 0 ? "like" : "dislike");
      return;
    }

    // Not far enough — snap back to center.
    setTransitioning(true);
    setDragX(0);
    setTimeout(() => setTransitioning(false), EXIT_MS);
  }

  if (done) {
    // Usually one frame — the effect above hands off to the taste map. But
    // SwipeFlow may be fetching another round, in which case this is the wait.
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-lg text-neon">{doneMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="cursor-grab touch-none active:cursor-grabbing"
      >
        <SongCard
          song={current}
          dragX={dragX}
          style={{
            transition: transitioning ? `transform ${EXIT_MS}ms ease-out` : "none",
          }}
        />
      </div>

      <div className="flex gap-6">
        <button
          type="button"
          onClick={() => commit("dislike")}
          aria-label="Dislike"
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-danger text-2xl text-danger transition-colors hover:bg-danger hover:text-bg"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => commit("like")}
          aria-label="Like"
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-neon text-2xl text-neon transition-colors hover:bg-neon hover:text-bg"
        >
          ♥
        </button>
      </div>

      <div className="flex gap-6 text-sm text-muted">
        <span className="w-14 text-center">
          <span className="font-semibold text-danger">{disliked}</span>{" "}
          disliked
        </span>
        <span className="w-14 text-center">
          <span className="font-semibold text-neon">{liked}</span> liked
        </span>
      </div>
    </div>
  );
}
