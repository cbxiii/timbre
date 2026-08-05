"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { RecommendedSongWithDesc } from "@/lib/types";
import SongCard, { SWIPE_THRESHOLD } from "./SongCard";
import Link from "next/link";

type SwipeDeckProps = {
  songs: RecommendedSongWithDesc[];
};

type Direction = "like" | "dislike";

const EXIT_MS = 300;

export default function SwipeDeck({ songs }: SwipeDeckProps) {
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<RecommendedSongWithDesc[]>([]);
  const [notLiked, setNotLiked] = useState<RecommendedSongWithDesc[]>([]);
  const [dragX, setDragX] = useState(0);
  // When true, the card animates (snap-back or fly-off); during a live drag we
  // want the card to track the pointer with no transition lag.
  const [transitioning, setTransitioning] = useState(false);

  const startX = useRef(0);
  const dragging = useRef(false);

  const current = songs[index];
  const done = index >= songs.length;

  // Record the like/dislike, fling the card off-screen, then advance once the
  // exit animation finishes. Both the buttons and a committed drag call this.
  function commit(direction: Direction) {
    if (transitioning || done) return;
    const song = songs[index];
    if (direction === "like") {
      setLiked((prev) => [...prev, song]);
    } else {
      setNotLiked((prev) => [...prev, song]);
    }

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
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="w-80 rounded-2xl border-2 border-neon bg-bg-elevated p-6 text-center">
          <h2 className="text-2xl font-bold text-neon">All done</h2>
          <p className="mt-2 text-sm text-muted">
            You swiped through {songs.length}{" "}
            {songs.length === 1 ? "song" : "songs"}.
          </p>

          <div className="mt-6 text-left">
            <p className="text-sm font-semibold text-neon">
              Liked ({liked.length})
            </p>
            <ul className="mt-1 text-sm text-muted">
              {liked.map((s) => (
                <li key={`${s.title}-${s.artist}`}>{s.title}</li>
              ))}
            </ul>

            <p className="mt-4 text-sm font-semibold text-danger">
              Not liked ({notLiked.length})
            </p>
            <ul className="mt-1 text-sm text-muted">
              {notLiked.map((s) => (
                <li key={`${s.title}-${s.artist}`}>{s.title}</li>
              ))}
            </ul>
          </div>
        </div>

        <button
          type="button"
          className="w-80 rounded-xl bg-neon py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
        >
          Get my taste profile
        </button>
        <Link
          href="/"
          className="w-80 rounded-xl bg-danger py-3 font-semibold text-bg text-center transition-colors hover:bg-red-700"
        >
          Start over
        </Link>
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
          <span className="font-semibold text-danger">{notLiked.length}</span>{" "}
          disliked
        </span>
        <span className="w-14 text-center">
          <span className="font-semibold text-neon">{liked.length}</span> liked
        </span>
      </div>
    </div>
  );
}
