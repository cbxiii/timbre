"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ArtistSongsDialog from "@/components/ArtistSongsDialog";
import {
  GUIDE_RING_FRACTIONS,
  layoutTasteMap,
  projectToRect,
  type ProjectedNode,
} from "@/lib/tasteMapLayout";
import type { TasteMapGraph, Verdict } from "@/lib/types";

type TasteMapProps = {
  graph: TasteMapGraph;
  verdicts: Map<string, Verdict>;
};

/**
 * The map is solved in the square MAP_SIZE space, then projected onto whatever
 * rectangle the viewport actually gives us (see projectToRect) so artists reach
 * the edges on a wide laptop and a tall phone alike. It renders as two aligned
 * layers over that rectangle: an SVG for the contours, links and dots, and
 * absolutely positioned HTML buttons for the artist labels. Both are driven by
 * the same measured pixel positions, so they stay locked together.
 *
 * Measuring is what the projection costs us. Only the projection reruns on
 * resize — the 400-tick force solve behind `nodes` is aspect-independent and
 * stays memoized.
 *
 * Labels are real buttons rather than SVG <text> so they get focus rings,
 * keyboard activation and aria-expanded for free. Clicking one opens
 * ArtistSongsDialog with that artist's curated songs.
 */
export default function TasteMap({ graph, verdicts }: TasteMapProps) {
  const nodes = useMemo(() => layoutTasteMap(graph, verdicts), [graph, verdicts]);
  const [selected, setSelected] = useState<string | null>(null);

  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Empty until the observer first fires, which is also what the server
  // renders — so there is nothing for hydration to disagree about.
  const projected = useMemo(
    () => (size ? projectToRect(nodes, size.w, size.h) : []),
    [nodes, size]
  );

  const byName = useMemo(
    () => new Map(projected.map((n) => [n.artist, n])),
    [projected]
  );
  const selectedNode = selected ? byName.get(selected) : undefined;

  const likedCount = useMemo(
    () => [...verdicts.values()].filter((v) => v === "like").length,
    [verdicts]
  );

  return (
    // Fixed and full-bleed: the map paints over the /swipe TIMBRE header, so
    // the map screen owns the whole viewport without the server layout needing
    // to know which state SwipeFlow is in.
    <div className="fixed inset-0 z-20 overflow-hidden bg-bg">
      {/* The plot rect: the viewport minus the bands the chrome sits in, so an
          overlay never lands on an artist. Deliberately not clipped — edge
          labels spill a little past their dot. */}
      <div
        ref={plotRef}
        className="absolute inset-x-4 top-28 bottom-24 sm:inset-x-16 sm:top-24 sm:bottom-20"
      >
        {size && (
          <>
            <svg
              viewBox={`0 0 ${size.w} ${size.h}`}
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              {/* Iso-fit contours. The envelope is the plot rect, so a contour
                  is that rect scaled down — not a circle. */}
              {GUIDE_RING_FRACTIONS.map((fraction) => (
                <rect
                  key={fraction}
                  x={(size.w * (1 - fraction)) / 2}
                  y={(size.h * (1 - fraction)) / 2}
                  width={size.w * fraction}
                  height={size.h * fraction}
                  rx={Math.min(size.w, size.h) * 0.06}
                  fill="none"
                  className="stroke-neon"
                  strokeOpacity={0.12}
                  strokeWidth={1}
                  strokeDasharray="4 8"
                />
              ))}

              {graph.links.map((link) => {
                const a = byName.get(link.source);
                const b = byName.get(link.target);
                if (!a || !b) return null;
                // Two similar artists with very different affinities are pinned
                // to very different rings, so some long links are unavoidable.
                // Fading by length keeps the local cluster structure readable.
                const length = Math.hypot(a.px - b.px, a.py - b.py);
                const diagonal = Math.hypot(size.w, size.h);
                const lengthFade = 1 - Math.min(length / (diagonal * 0.6), 0.75);
                return (
                  <line
                    key={`${link.source}|${link.target}`}
                    x1={a.px}
                    y1={a.py}
                    x2={b.px}
                    y2={b.py}
                    className="stroke-neon"
                    strokeOpacity={(0.08 + link.sim * 0.24) * lengthFade}
                    strokeWidth={1}
                  />
                );
              })}

              {projected.map((node) => (
                <circle
                  key={node.artist}
                  cx={node.px}
                  cy={node.py}
                  r={node.isSeed ? 5 : 3}
                  className="fill-neon"
                  fillOpacity={node.isSeed ? 1 : 0.35 + node.affinity * 0.5}
                />
              ))}
            </svg>

            <div className="absolute inset-0">
              {projected.map((node) => (
                <ArtistLabel
                  key={node.artist}
                  node={node}
                  isSelected={selected === node.artist}
                  onSelect={() =>
                    setSelected((prev) =>
                      prev === node.artist ? null : node.artist
                    )
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chrome floats over the map so the plot itself can own the viewport.
          Wrappers are click-through; only real controls opt back in. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 p-6 text-center">
        <h2 className="text-xl font-bold text-neon">Your taste map</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          Closer to the center means a better fit. Built from{" "}
          {graph.artists.filter((a) => a.isSeed).length} seed{" "}
          {graph.artists.filter((a) => a.isSeed).length === 1
            ? "artist"
            : "artists"}{" "}
          and {likedCount} {likedCount === 1 ? "song" : "songs"} you liked.
        </p>
      </header>

      {/* The radius axis, explained outside the plot — an in-map ring label
          would sit exactly where artists sit. */}
      <div className="pointer-events-none absolute bottom-6 left-6 hidden w-64 items-center gap-3 text-[0.7rem] text-muted sm:flex">
        <span className="whitespace-nowrap">your taste</span>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-neon to-transparent"
        />
        <span className="whitespace-nowrap">furthest reach</span>
      </div>

      <Link
        href="/"
        className="absolute right-6 bottom-6 rounded-xl bg-neon px-6 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
      >
        Start over
      </Link>

      <ArtistSongsDialog
        node={selectedNode}
        verdicts={verdicts}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ArtistLabel({
  node,
  isSelected,
  onSelect,
}: {
  node: ProjectedNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const position = {
    left: `${node.px}px`,
    top: `${node.py}px`,
    // Nudge labels off their dot so the marker stays visible.
    transform: "translate(-50%, -140%)",
  };

  // Artists the LLM picked no songs from still appear — they honestly show how
  // far the search reached — but there's nothing to expand. Seeds are always
  // interactive: candidates only come from discovered artists, so a seed
  // normally has no songs of its own, and it still anchors the map.
  if (node.songs.length === 0 && !node.isSeed) {
    return (
      <span
        style={position}
        title={`${node.artist} — no curated songs`}
        className="absolute whitespace-nowrap text-[0.65rem] text-muted/50"
      >
        {node.artist}
      </span>
    );
  }

  const emphasis = node.isSeed
    ? "text-sm font-bold text-neon"
    : node.affinity > 0.6
      ? "text-xs font-semibold text-neon"
      : "text-[0.7rem] text-neon/70";

  return (
    <button
      type="button"
      onClick={onSelect}
      style={position}
      aria-haspopup="dialog"
      aria-expanded={isSelected}
      className={`absolute cursor-pointer rounded whitespace-nowrap px-1 transition-colors hover:bg-neon hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon ${emphasis} ${
        isSelected ? "bg-neon text-bg" : ""
      }`}
    >
      {node.artist}
    </button>
  );
}

