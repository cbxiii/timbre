"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  buildTasteMapGraph,
  nameKey,
  type MatrixResponse,
} from "@/lib/tasteMapGraph";
import { songKey } from "@/lib/tasteMapLayout";
import type {
  RecommendedSongWithDesc,
  RecommendedTrack,
  SearchParams,
  SimilarArtist,
  TasteMapGraph,
  Verdict,
} from "@/lib/types";
import SwipeDeck from "./SwipeDeck";
import TasteMap from "./TasteMap";

type SwipeFlowProps = {
  params: SearchParams;
};

// Arbitrary fan-out knobs — tune later (see plan). Adventurousness is passed
// through to /refine but does not yet bias candidate obscurity.
const SIMILAR_LIMIT = 8; // similar artists fetched per seed
const MAX_EXPAND_ARTISTS = 12; // how many similar artists we pull tracks from
const TOPTRACKS_LIMIT = 5; // top tracks per expanded artist
// Similar-name lists are only used to find edges *between* artists already on
// the map, so a wider list finds more of them at no enrichment cost.
const MATRIX_LIMIT = 40;

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; songs: RecommendedSongWithDesc[]; graph: TasteMapGraph };

/** Run the full discovery pipeline for the seed params, returning curated songs. */
async function runPipeline(
  params: SearchParams,
  signal: AbortSignal,
): Promise<{ songs: RecommendedSongWithDesc[]; graph: TasteMapGraph }> {
  // 1. Similar artists for each seed (lenient: keep whatever resolves).
  const similarResults = await Promise.allSettled(
    params.artists.map((artist) =>
      fetch(
        `/api/recommend/similar?artist=${encodeURIComponent(artist)}&limit=${SIMILAR_LIMIT}`,
        { signal },
      ).then((res) => (res.ok ? (res.json() as Promise<SimilarArtist[]>) : [])),
    ),
  );

  // 2. Pool similar artists, dedup case-insensitively, then cap fan-out. We keep
  //    the whole SimilarArtist — its match score, listener count and tags are
  //    what position it on the taste map — and take the best match across seeds
  //    when more than one seed surfaced the same artist.
  const seedKeys = new Set(params.artists.map(nameKey));
  const discovered = new Map<string, SimilarArtist>();
  for (const result of similarResults) {
    if (result.status !== "fulfilled") continue;
    for (const similar of result.value) {
      const key = nameKey(similar.artist);
      if (seedKeys.has(key)) continue;
      const existing = discovered.get(key);
      if (!existing) {
        if (discovered.size >= MAX_EXPAND_ARTISTS) continue;
        discovered.set(key, similar);
      } else if (similar.match > existing.match) {
        discovered.set(key, { ...existing, match: similar.match });
      }
    }
  }
  const expandArtists = [...discovered.values()].map((a) => a.artist);

  // 3. Top tracks for each expanded artist; flatten + dedup into a candidate pool.
  const trackResults = await Promise.allSettled(
    expandArtists.map((artist) =>
      fetch(
        `/api/recommend/top-tracks?artist=${encodeURIComponent(artist)}&limit=${TOPTRACKS_LIMIT}`,
        { signal },
      ).then((res) => (res.ok ? (res.json() as Promise<RecommendedTrack[]>) : [])),
    ),
  );

  const candidatesByKey = new Map<string, RecommendedTrack>();
  for (const result of trackResults) {
    if (result.status !== "fulfilled") continue;
    for (const track of result.value) {
      candidatesByKey.set(songKey(track), track);
    }
  }
  const candidates = [...candidatesByKey.values()];

  if (candidates.length === 0) {
    throw new Error(
      "Couldn't find any songs for those artists. Try different seeds.",
    );
  }

  // 3.5. Match scores *between* discovered artists, for the taste map's lateral
  //      layout. This route skips the getInfo enrichment (we already hold
  //      listener counts and tags), so it's one flat call per artist. A partial
  //      matrix is fine — missing pairs fall back to tag overlap.
  const matrixResults = await Promise.allSettled(
    expandArtists.map((artist) =>
      fetch(
        `/api/recommend/similar-names?artist=${encodeURIComponent(artist)}&limit=${MATRIX_LIMIT}`,
        { signal },
      )
        .then((res) =>
          res.ok
            ? (res.json() as Promise<Array<{ artist: string; match: number }>>)
            : [],
        )
        .then((similar) => ({ artist, similar })),
    ),
  );

  // 4. Refine the pool with the LLM.
  const res = await fetch("/api/recommend/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params, candidates }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to refine recommendations.");
  }
  const songs = (await res.json()) as RecommendedSongWithDesc[];

  // 5. Assemble the taste map graph from the curated songs plus the artist
  //    metadata gathered above. Partial matrix results are fine.
  const matrixResponses = matrixResults
    .filter((r): r is PromiseFulfilledResult<MatrixResponse> =>
      r.status === "fulfilled",
    )
    .map((r) => r.value);

  const graph = buildTasteMapGraph(
    params.artists,
    discovered.values(),
    songs,
    matrixResponses,
  );

  return { songs, graph };
}

export default function SwipeFlow({ params }: SwipeFlowProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  // Swipe verdicts live here, not in SwipeDeck, because the taste map is built
  // from them once the deck runs out.
  const [verdicts, setVerdicts] = useState<Map<string, Verdict>>(new Map());
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    runPipeline(params, controller.signal)
      .then(({ songs, graph }) =>
        setStatus({ phase: "ready", songs, graph }),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({
          phase: "error",
          message:
            err instanceof Error ? err.message : "Something went wrong.",
        });
      });

    return () => controller.abort();
    // The page keys this component by seed, so a new seed remounts it (fresh
    // "loading" state) rather than re-running this effect in place.
  }, [params]);

  const handleVerdict = useCallback(
    (song: RecommendedSongWithDesc, verdict: Verdict) => {
      setVerdicts((prev) => new Map(prev).set(songKey(song), verdict));
    },
    [],
  );

  const handleFinished = useCallback(() => setFinished(true), []);

  if (status.phase === "loading") {
    return (
      <Centered>
        <p className="text-lg text-neon">Finding your songs…</p>
        <p className="mt-2 text-sm text-muted">
          Discovering similar artists and curating picks.
        </p>
      </Centered>
    );
  }

  if (status.phase === "error") {
    return (
      <Centered>
        <p className="text-lg font-semibold text-danger">{status.message}</p>
        <Link
          href="/"
          className="mt-6 rounded-xl bg-neon px-6 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
        >
          Start over
        </Link>
      </Centered>
    );
  }

  if (status.songs.length === 0) {
    return (
      <Centered>
        <p className="text-lg text-muted">
          No recommendations came back. Try different artists or moods.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-xl bg-neon px-6 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
        >
          Start over
        </Link>
      </Centered>
    );
  }

  if (finished) {
    return <TasteMap graph={status.graph} verdicts={verdicts} />;
  }

  return (
    <SwipeDeck
      songs={status.songs}
      verdicts={verdicts}
      onVerdict={handleVerdict}
      onFinished={handleFinished}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
