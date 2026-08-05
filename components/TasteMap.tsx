"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  GUIDE_RINGS,
  MAP_CENTER,
  MAP_SIZE,
  layoutTasteMap,
  songKey,
  type LaidOutNode,
} from "@/lib/tasteMapLayout";
import type { TasteMapGraph, Verdict } from "@/lib/types";

type TasteMapProps = {
  graph: TasteMapGraph;
  verdicts: Map<string, Verdict>;
};

/**
 * The map is laid out in a fixed MAP_SIZE coordinate space and rendered as two
 * aligned layers: an SVG for the rings, links and dots, and absolutely
 * positioned HTML buttons for the artist labels. Both address the same space in
 * percentages, so they stay locked together at any rendered size — which also
 * means no measurement, no ResizeObserver, and no need for a client-only
 * dynamic import.
 *
 * Labels are real buttons rather than SVG <text> so they get focus rings,
 * keyboard activation and aria-expanded for free.
 */
export default function TasteMap({ graph, verdicts }: TasteMapProps) {
  const nodes = useMemo(() => layoutTasteMap(graph, verdicts), [graph, verdicts]);
  const [selected, setSelected] = useState<string | null>(null);

  const byName = useMemo(
    () => new Map(nodes.map((n) => [n.artist, n])),
    [nodes]
  );
  const selectedNode = selected ? byName.get(selected) : undefined;

  const likedCount = useMemo(
    () => [...verdicts.values()].filter((v) => v === "like").length,
    [verdicts]
  );

  const pct = (v: number) => `${(v / MAP_SIZE) * 100}%`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 pb-12 lg:flex-row lg:items-start lg:justify-center">
      <div className="flex flex-col items-center">
        <header className="mb-2 max-w-md text-center">
          <h2 className="text-xl font-bold text-neon">Your taste map</h2>
          <p className="mt-1 text-sm text-muted">
            Closer to the center means a better fit. Built from{" "}
            {graph.artists.filter((a) => a.isSeed).length} seed{" "}
            {graph.artists.filter((a) => a.isSeed).length === 1
              ? "artist"
              : "artists"}{" "}
            and {likedCount} {likedCount === 1 ? "song" : "songs"} you liked.
          </p>
        </header>

        <div className="relative aspect-square w-full max-w-2xl">
          <svg
            viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {GUIDE_RINGS.map((radius) => (
              <circle
                key={radius}
                cx={MAP_CENTER}
                cy={MAP_CENTER}
                r={radius}
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
              // Two similar artists with very different affinities are pinned to
              // very different rings, so some long links are unavoidable. Fading
              // by length keeps the local cluster structure readable.
              const length = Math.hypot(a.x - b.x, a.y - b.y);
              const lengthFade = 1 - Math.min(length / (MAP_SIZE * 0.6), 0.75);
              return (
                <line
                  key={`${link.source}|${link.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-neon"
                  strokeOpacity={(0.08 + link.sim * 0.24) * lengthFade}
                  strokeWidth={1}
                />
              );
            })}

            {nodes.map((node) => (
              <circle
                key={node.artist}
                cx={node.x}
                cy={node.y}
                r={node.isSeed ? 6 : 3.5}
                className={node.isSeed ? "fill-neon" : "fill-neon"}
                fillOpacity={node.isSeed ? 1 : 0.35 + node.affinity * 0.5}
              />
            ))}
          </svg>

          <div className="absolute inset-0">
            {nodes.map((node) => (
              <ArtistLabel
                key={node.artist}
                node={node}
                left={pct(node.x)}
                top={pct(node.y)}
                isSelected={selected === node.artist}
                onSelect={() =>
                  setSelected((prev) =>
                    prev === node.artist ? null : node.artist
                  )
                }
              />
            ))}
          </div>
        </div>

        {/* The radius axis, explained outside the plot — an in-map ring label
            would sit exactly where artists sit. */}
        <div className="mt-2 flex w-full max-w-md items-center gap-3 text-[0.7rem] text-muted">
          <span className="whitespace-nowrap">your taste</span>
          <span
            aria-hidden="true"
            className="h-px flex-1 bg-gradient-to-r from-neon to-transparent"
          />
          <span className="whitespace-nowrap">furthest reach</span>
        </div>

        <Link
          href="/"
          className="mt-6 rounded-xl bg-neon px-6 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
        >
          Start over
        </Link>
      </div>

      <SongPanel node={selectedNode} verdicts={verdicts} />
    </div>
  );
}

function ArtistLabel({
  node,
  left,
  top,
  isSelected,
  onSelect,
}: {
  node: LaidOutNode;
  left: string;
  top: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const position = {
    left,
    top,
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
      aria-expanded={isSelected}
      className={`absolute cursor-pointer rounded whitespace-nowrap px-1 transition-colors hover:bg-neon hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon ${emphasis} ${
        isSelected ? "bg-neon text-bg" : ""
      }`}
    >
      {node.artist}
    </button>
  );
}

function SongPanel({
  node,
  verdicts,
}: {
  node: LaidOutNode | undefined;
  verdicts: Map<string, Verdict>;
}) {
  if (!node) {
    return (
      <aside className="w-full shrink-0 rounded-2xl border border-neon/20 bg-bg-elevated p-6 lg:w-80">
        <p className="text-sm text-muted">
          Pick any artist on the map to see the songs we found for them and why
          they fit.
        </p>
      </aside>
    );
  }

  return (
    <aside
      aria-labelledby="taste-map-panel-heading"
      className="w-full shrink-0 rounded-2xl border-2 border-neon bg-bg-elevated p-6 lg:w-80"
    >
      <h3
        id="taste-map-panel-heading"
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

      {node.songs.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          Everything on this map was discovered from here — the songs live under
          the artists around it.
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
                  {verdict === "like" ? "♥" : verdict === "dislike" ? "✕" : "·"}
                </span>
                <p className="text-sm font-semibold text-neon">{song.title}</p>
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
    </aside>
  );
}
