"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  RecommendedSongWithDesc,
  RecommendedTrack,
  SearchParams,
  SimilarArtist,
} from "@/lib/types";
import SwipeDeck from "./SwipeDeck";

type SwipeFlowProps = {
  params: SearchParams;
};

// Arbitrary fan-out knobs — tune later (see plan). Adventurousness is passed
// through to /refine but does not yet bias candidate obscurity.
const SIMILAR_LIMIT = 8; // similar artists fetched per seed
const MAX_EXPAND_ARTISTS = 12; // how many similar artists we pull tracks from
const TOPTRACKS_LIMIT = 5; // top tracks per expanded artist

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; songs: RecommendedSongWithDesc[] };

function dedupeKey(artist: string, title: string) {
  return `${artist.toLowerCase()}|${title.toLowerCase()}`;
}

/** Run the full discovery pipeline for the seed params, returning curated songs. */
async function runPipeline(
  params: SearchParams,
  signal: AbortSignal,
): Promise<RecommendedSongWithDesc[]> {
  // 1. Similar artists for each seed (lenient: keep whatever resolves).
  const similarResults = await Promise.allSettled(
    params.artists.map((artist) =>
      fetch(
        `/api/recommend/similar?artist=${encodeURIComponent(artist)}&limit=${SIMILAR_LIMIT}`,
        { signal },
      ).then((res) => (res.ok ? (res.json() as Promise<SimilarArtist[]>) : [])),
    ),
  );

  // 2. Pool similar-artist names, dedup case-insensitively, then cap fan-out.
  const seen = new Set(params.artists.map((a) => a.toLowerCase()));
  const expandArtists: string[] = [];
  for (const result of similarResults) {
    if (result.status !== "fulfilled") continue;
    for (const { artist } of result.value) {
      const key = artist.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      expandArtists.push(artist);
      if (expandArtists.length >= MAX_EXPAND_ARTISTS) break;
    }
    if (expandArtists.length >= MAX_EXPAND_ARTISTS) break;
  }

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
      candidatesByKey.set(dedupeKey(track.artist, track.title), track);
    }
  }
  const candidates = [...candidatesByKey.values()];

  if (candidates.length === 0) {
    throw new Error(
      "Couldn't find any songs for those artists. Try different seeds.",
    );
  }

  // 4. Refine the pool with the LLM and return the curated songs.
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
  return res.json() as Promise<RecommendedSongWithDesc[]>;
}

export default function SwipeFlow({ params }: SwipeFlowProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    runPipeline(params, controller.signal)
      .then((songs) => setStatus({ phase: "ready", songs }))
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

  return <SwipeDeck songs={status.songs} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
