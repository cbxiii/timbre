"use client";

import { useEffect, useRef } from "react";
import { songKey, type LaidOutNode } from "@/lib/tasteMapLayout";
import type { Verdict } from "@/lib/types";

type ArtistSongsDialogProps = {
  node: LaidOutNode | undefined;
  verdicts: Map<string, Verdict>;
  onClose: () => void;
};

/**
 * The curated songs for one artist on the taste map.
 *
 * A native <dialog> driven by showModal() rather than a hand-rolled overlay:
 * it brings focus trapping, Escape-to-close, focus restoration to the artist
 * label that opened it, and top-layer stacking — so it sits above the
 * full-viewport map without any z-index coordination.
 */
export default function ArtistSongsDialog({
  node,
  verdicts,
  onClose,
}: ArtistSongsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (node && !el.open) el.showModal();
    if (!node && el.open) el.close();
  }, [node]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicks that land on the dialog element itself, rather than on the
      // content wrapper inside it, are backdrop clicks.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="artist-songs-heading"
      className="m-auto w-[min(28rem,90vw)] max-h-[80dvh] overflow-y-auto rounded-2xl border-2 border-neon bg-bg-elevated p-6 text-left backdrop:bg-black/70"
    >
      {node && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                id="artist-songs-heading"
                className="text-lg font-bold text-neon"
              >
                {node.artist}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {node.isSeed
                  ? "One of your seed artists"
                  : `${Math.round(node.affinity * 100)}% fit`}
                {node.tags.length > 0 && ` · ${node.tags.slice(0, 3).join(", ")}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded px-2 py-1 text-muted transition-colors hover:text-neon focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon"
            >
              ✕
            </button>
          </div>

          {node.songs.length === 0 && (
            <p className="mt-4 text-sm text-muted">
              Everything on this map was discovered from here — the songs live
              under the artists around it.
            </p>
          )}

          <ul className="mt-5 flex flex-col gap-4">
            {node.songs.map((song) => {
              const verdict = verdicts.get(songKey(song));
              return (
                <li key={songKey(song)}>
                  <div className="flex items-baseline gap-2">
                    <span
                      aria-label={
                        verdict === "like"
                          ? "liked"
                          : verdict === "dislike"
                            ? "disliked"
                            : "not swiped"
                      }
                      className={
                        verdict === "like"
                          ? "text-neon"
                          : verdict === "dislike"
                            ? "text-danger"
                            : "text-muted/50"
                      }
                    >
                      {verdict === "like"
                        ? "♥"
                        : verdict === "dislike"
                          ? "✕"
                          : "·"}
                    </span>
                    <p className="text-sm font-semibold text-neon">
                      {song.title}
                    </p>
                  </div>
                  {song.description && (
                    <p className="mt-1 pl-5 text-xs leading-relaxed text-muted">
                      {song.description}
                    </p>
                  )}
                  <a
                    href={song.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 ml-5 inline-block text-xs font-semibold text-neon transition-colors hover:text-neon-dim"
                  >
                    ▶ Listen on YouTube
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </dialog>
  );
}
