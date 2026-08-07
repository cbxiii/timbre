"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { selectDeck } from "@/lib/deck";
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
  SwipeFeedback,
  TasteMapGraph,
  Verdict,
} from "@/lib/types";
import SwipeDeck from "./SwipeDeck";
import TasteMap from "./TasteMap";

type SwipeFlowProps = {
  params: SearchParams;
};

// Arbitrary fan-out knobs — tune later (see plan).
const SIMILAR_LIMIT = 8; // similar artists fetched per seed
const MAX_EXPAND_ARTISTS = 12; // how many similar artists we pull tracks from
const TOPTRACKS_LIMIT = 5; // top tracks per expanded artist
// Similar-name lists are only used to find edges *between* artists already on
// the map, so a wider list finds more of them at no enrichment cost.
const MATRIX_LIMIT = 40;

// Cards dealt per round. One card per artist, so these are artist counts too.
// The pool is far larger than this on purpose: everything not dealt still
// reaches the map, placed by its prior instead of by a verdict.
const ROUND_1_CARDS = 5;
const ROUND_2_CARDS = 5;
/** Similar artists pulled per swiped artist, to feed the expansion round. */
const EXPAND_SIMILAR_LIMIT = 10;
/** Ceiling on how many new artists the expansion adds to the map. */
const MAX_NEW_ARTISTS = 10;
/** Hard stop: the initial deck, one expansion, then the map. */
const MAX_ROUNDS = 2;

/**
 * Everything gathered so far. Held whole rather than as scattered pieces because
 * the expansion round has to rebuild the graph from the *combined* set of both
 * rounds — a graph built from round 2 alone would drop round 1's artists.
 */
interface Session {
  /** Every curated song from every round. The map is built from all of them. */
  songs: RecommendedSongWithDesc[];
  discovered: Map<string, SimilarArtist>;
  matrixResponses: MatrixResponse[];
  graph: TasteMapGraph;
  /** The cards actually dealt, in order. Appended to, never reordered — the
   *  deck's own index counts through it. */
  deck: RecommendedSongWithDesc[];
}

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; session: Session };

/**
 * Top tracks for a set of artists, flattened and deduped into a candidate pool.
 *
 * Tracks are credited to the name we *asked* about. Last.fm's autocorrect=1 can
 * return "Beyoncé" for a getSimilar name of "Beyonce", and since the getSimilar
 * name is what becomes the map node, that drift would leave the node with no
 * songs while spawning a duplicate node to hold them.
 */
async function fetchTracksFor(
  artists: string[],
  signal: AbortSignal,
): Promise<RecommendedTrack[]> {
  const results = await Promise.allSettled(
    artists.map((artist) =>
      fetch(
        `/api/recommend/top-tracks?artist=${encodeURIComponent(artist)}&limit=${TOPTRACKS_LIMIT}`,
        { signal },
      ).then((res) => (res.ok ? (res.json() as Promise<RecommendedTrack[]>) : [])),
    ),
  );

  const byKey = new Map<string, RecommendedTrack>();
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    for (const track of result.value) {
      const credited = { ...track, artist: artists[i] };
      byKey.set(songKey(credited), credited);
    }
  });
  return [...byKey.values()];
}

/**
 * Match scores *between* artists, for the taste map's lateral layout. This route
 * skips the getInfo enrichment (we already hold listener counts and tags), so
 * it's one flat call per artist. A partial matrix is fine — missing pairs fall
 * back to tag overlap.
 */
async function fetchMatrixFor(
  artists: string[],
  signal: AbortSignal,
): Promise<MatrixResponse[]> {
  const results = await Promise.allSettled(
    artists.map((artist) =>
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

  return results
    .filter((r): r is PromiseFulfilledResult<MatrixResponse> =>
      r.status === "fulfilled",
    )
    .map((r) => r.value);
}

/** POST the candidate pool to the LLM refine step. */
async function refine(
  params: SearchParams,
  candidates: RecommendedTrack[],
  feedback: SwipeFeedback | undefined,
  signal: AbortSignal,
): Promise<RecommendedSongWithDesc[]> {
  const res = await fetch("/api/recommend/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params, candidates, feedback }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to refine recommendations.");
  }
  return (await res.json()) as RecommendedSongWithDesc[];
}

/** The first round: seeds → similar artists → tracks → LLM → graph → deck. */
async function runPipeline(
  params: SearchParams,
  signal: AbortSignal,
): Promise<Session> {
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

  // 3. Candidate tracks and the similarity matrix, in parallel — neither needs
  //    the other, and both only need the artist names.
  const [candidates, matrixResponses] = await Promise.all([
    fetchTracksFor(expandArtists, signal),
    fetchMatrixFor(expandArtists, signal),
  ]);

  if (candidates.length === 0) {
    throw new Error(
      "Couldn't find any songs for those artists. Try different seeds.",
    );
  }

  // 4. Refine the pool with the LLM. No feedback yet — nothing is swiped.
  const songs = await refine(params, candidates, undefined, signal);

  // 5. Assemble the graph, then deal the opening hand from it.
  const graph = buildTasteMapGraph(
    params.artists,
    discovered.values(),
    songs,
    matrixResponses,
  );
  const deck = selectDeck(graph.artists, params.adventurousness, ROUND_1_CARDS);

  return { songs, discovered, matrixResponses, graph, deck };
}

export default function SwipeFlow({ params }: SwipeFlowProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  // Swipe verdicts live here, not in SwipeDeck, because the taste map is built
  // from them once the deck runs out.
  const [verdicts, setVerdicts] = useState<Map<string, Verdict>>(new Map());
  const [finished, setFinished] = useState(false);
  const [expanding, setExpanding] = useState(false);

  // Mirrors of the above, for the callbacks below. SwipeDeck calls onFinished
  // from an effect keyed on that callback's identity, so onFinished has to stay
  // referentially stable or it re-fires on every re-render while the deck is
  // done. Reading through refs is what keeps its dependency list empty.
  const sessionRef = useRef<Session | null>(null);
  const verdictsRef = useRef(new Map<string, Verdict>());
  const roundRef = useRef(1);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  /** Similar-artist lists, requested the moment a card is swiped. By nameKey. */
  const similarRef = useRef(new Map<string, Promise<SimilarArtist[]>>());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    runPipeline(params, controller.signal)
      .then((session) => {
        sessionRef.current = session;
        setStatus({ phase: "ready", session });
      })
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

  /**
   * Start pulling an artist's neighbours the instant their card is swiped, so
   * the pool is warm by the time the deck runs dry. Cheap enough to do for
   * dislikes too — those lists become the veto set.
   */
  const prefetchSimilar = useCallback((artist: string) => {
    const key = nameKey(artist);
    if (similarRef.current.has(key)) return;
    similarRef.current.set(
      key,
      fetch(
        `/api/recommend/similar?artist=${encodeURIComponent(artist)}&limit=${EXPAND_SIMILAR_LIMIT}`,
        { signal: abortRef.current?.signal },
      )
        .then((res) => (res.ok ? (res.json() as Promise<SimilarArtist[]>) : []))
        // Swallowed rather than surfaced: this is speculative work, and it may
        // never be awaited at all if the user dislikes everything.
        .catch(() => []),
    );
  }, []);

  const handleVerdict = useCallback(
    (song: RecommendedSongWithDesc, verdict: Verdict) => {
      verdictsRef.current.set(songKey(song), verdict);
      setVerdicts(new Map(verdictsRef.current));
      prefetchSimilar(song.artist);
    },
    [prefetchSimilar],
  );

  /**
   * Build the next round from what the user liked, or return null if there is
   * nothing worth asking about — in which case the flow goes to the map.
   */
  const expand = useCallback(async (): Promise<Session | null> => {
    const session = sessionRef.current;
    const signal = abortRef.current?.signal;
    if (!session || !signal) return null;

    const liked: string[] = [];
    const disliked: string[] = [];
    for (const song of session.deck) {
      const verdict = verdictsRef.current.get(songKey(song));
      if (verdict === "like") liked.push(song.artist);
      else if (verdict === "dislike") disliked.push(song.artist);
    }
    // Nothing liked means nothing to expand *from*; go to the map.
    if (liked.length === 0) return null;

    const listFor = (artist: string) =>
      similarRef.current.get(nameKey(artist)) ?? Promise.resolve([]);
    const [likedLists, dislikedLists] = await Promise.all([
      Promise.all(liked.map(listFor)),
      Promise.all(disliked.map(listFor)),
    ]);

    // "Suggest fewer artists like that one" has no Last.fm equivalent — there is
    // no negative query — so it becomes a subtraction instead: a disliked
    // artist's whole neighbourhood is off-limits for this round.
    const veto = new Set(disliked.map(nameKey));
    for (const list of dislikedLists) {
      for (const similar of list) veto.add(nameKey(similar.artist));
    }

    const known = new Set(session.graph.artists.map((a) => nameKey(a.artist)));
    for (const seed of params.artists) known.add(nameKey(seed));

    const fresh = new Map<string, SimilarArtist>();
    for (const list of likedLists) {
      for (const similar of list) {
        const key = nameKey(similar.artist);
        if (known.has(key) || veto.has(key)) continue;
        const existing = fresh.get(key);
        if (!existing || similar.match > existing.match) {
          fresh.set(key, similar);
        }
      }
    }

    const newArtists = [...fresh.values()]
      .sort((a, b) => b.match - a.match)
      .slice(0, MAX_NEW_ARTISTS);
    if (newArtists.length === 0) return null;

    const names = newArtists.map((a) => a.artist);
    const [candidates, matrix] = await Promise.all([
      fetchTracksFor(names, signal),
      fetchMatrixFor(names, signal),
    ]);
    if (candidates.length === 0) return null;

    // One refine call for the whole round, with every verdict as context — far
    // better curation than a call per like, and a tenth of the cost.
    const newSongs = await refine(
      params,
      candidates,
      { liked, disliked },
      signal,
    );

    const discovered = new Map(session.discovered);
    for (const artist of newArtists) {
      discovered.set(nameKey(artist.artist), artist);
    }
    const songs = [...session.songs, ...newSongs];
    const matrixResponses = [...session.matrixResponses, ...matrix];
    const graph = buildTasteMapGraph(
      params.artists,
      discovered.values(),
      songs,
      matrixResponses,
    );

    // Round two asks only about artists the likes actually surfaced, so the
    // round means what it says. Passing every round-one name as "already shown"
    // is what restricts it, while still ranking against the full pool.
    const round2 = selectDeck(
      graph.artists,
      params.adventurousness,
      ROUND_2_CARDS,
      known,
    );
    if (round2.length === 0) return null;

    return {
      songs,
      discovered,
      matrixResponses,
      graph,
      deck: [...session.deck, ...round2],
    };
  }, [params]);

  const handleFinished = useCallback(() => {
    if (doneRef.current || busyRef.current) return;

    if (roundRef.current >= MAX_ROUNDS) {
      doneRef.current = true;
      setFinished(true);
      return;
    }

    busyRef.current = true;
    setExpanding(true);
    expand()
      .then((next) => {
        if (!next) {
          doneRef.current = true;
          setFinished(true);
          return;
        }
        roundRef.current += 1;
        sessionRef.current = next;
        setStatus({ phase: "ready", session: next });
      })
      .catch(() => {
        // A failed expansion is not worth losing the map over — the user has
        // already swiped a full round, and that is enough to place everyone.
        doneRef.current = true;
        setFinished(true);
      })
      .finally(() => {
        busyRef.current = false;
        setExpanding(false);
      });
  }, [expand]);

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

  if (status.session.deck.length === 0) {
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
    return (
      <TasteMap
        graph={status.session.graph}
        verdicts={verdicts}
        adventurousness={params.adventurousness}
      />
    );
  }

  // SwipeDeck stays mounted across the expansion — it owns the card index, and
  // unmounting it would restart the deck from the first card.
  return (
    <SwipeDeck
      songs={status.session.deck}
      verdicts={verdicts}
      onVerdict={handleVerdict}
      onFinished={handleFinished}
      doneMessage={
        expanding
          ? "Finding more like what you liked…"
          : "Building your taste map…"
      }
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
