"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  pivotAdventurousness,
  selectDeck,
  selectPivotArtists,
  type PivotDirection,
} from "@/lib/deck";
import {
  buildTasteMapGraph,
  nameKey,
  type MatrixResponse,
} from "@/lib/tasteMapGraph";
import { songKey } from "@/lib/tasteMapLayout";
import type {
  Mood,
  RecommendedSongWithDesc,
  RecommendedTrack,
  SearchParams,
  SimilarArtist,
  SwipeFeedback,
  TasteMapGraph,
  Verdict,
} from "@/lib/types";
import PivotPrompt from "./PivotPrompt";
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

// Cards dealt per round. One card per artist, so this is an artist count too.
// The pool is far larger than this on purpose: everything not dealt still
// reaches the map, placed by its prior instead of by a verdict.
const ROUND_CARDS = 5;
/** Similar artists pulled per swiped artist, to feed the expansion round. */
const EXPAND_SIMILAR_LIMIT = 10;
/** Ceiling on how many new artists a single round adds to the map. */
const MAX_NEW_ARTISTS = 10;
/** Hard stop: the initial deck plus up to three more rounds, then the map. */
const MAX_ROUNDS = 4;

/**
 * Artists pulled per seed on a pivot round, from further down that seed's
 * similar list. Kept narrow because `/api/recommend/similar` enriches every
 * result it returns (N+1 getInfo), and the window — not how far we skipped to
 * reach it — is what that costs.
 */
const SEED_WINDOW = 12;

/**
 * The share of a round's cards that must be dislikes before we stop guessing and
 * ask the user which way to go. Below this there is enough positive signal for
 * the ordinary like-driven expansion to work.
 */
const DISLIKE_HEAVY = 0.6;

/**
 * Cards a round needs before that ratio means anything. `selectDeck` deals fewer
 * than `ROUND_CARDS` once the pool thins out, and a one-card round is 0% or 100%
 * dislikes by construction.
 */
const MIN_ROUND_FOR_PIVOT = 3;

/**
 * Fresh artists a round needs before the neighbourhood veto is allowed to stand.
 * Under this the veto is relaxed — see `freshArtists`.
 *
 * Comfortably above the ROUND_CARDS the deck must deal, because not every fresh
 * artist survives to become a card: `buildTasteMapGraph` drops any whose
 * top-tracks came back empty, and `selectDeck` skips any left without songs.
 */
const MIN_FRESH = 8;

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
  /**
   * Where the current round's cards start in `deck`. "Was this round mostly
   * dislikes?" is a question about the latest round only, and both `deck` and
   * SwipeDeck's own counters are cumulative across rounds.
   */
  roundStartIndex: number;
}

type Status =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; session: Session };

/**
 * Where the swipe loop is. One value rather than a handful of booleans, because
 * the invalid combinations are what break this: "expanding and awaiting", or
 * "done but still swiping", would each let a round fire twice.
 */
type FlowPhase =
  /** Cards on screen; running out of them means something. */
  | "swiping"
  /** A round is in flight. */
  | "expanding"
  /** The interstitial is open and the next move is the user's. */
  | "awaiting"
  /** Terminal: the taste map. */
  | "done";

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

/**
 * What the swipes so far say, as artist names. Deduped because the same artist
 * must never appear twice in the feedback the LLM reads as a tally.
 */
function partitionVerdicts(
  deck: RecommendedSongWithDesc[],
  verdicts: Map<string, Verdict>,
): SwipeFeedback {
  const liked = new Set<string>();
  const disliked = new Set<string>();
  for (const song of deck) {
    const verdict = verdicts.get(songKey(song));
    if (verdict === "like") liked.add(song.artist);
    else if (verdict === "dislike") disliked.add(song.artist);
  }
  return { liked: [...liked], disliked: [...disliked] };
}

/**
 * Every artist we've already reached for, plus the seeds. Nothing here is worth
 * offering again.
 *
 * Drawn from `discovered` as well as the graph, not just the graph:
 * `buildTasteMapGraph` drops any discovered artist whose top-tracks came back
 * empty, so those artists exist in `discovered` but have no node. Keying only off
 * the graph would re-fetch them every single round, re-fail, and burn a slot out
 * of `MAX_NEW_ARTISTS` each time.
 */
function knownKeys(session: Session, seeds: string[]): Set<string> {
  const known = new Set(session.discovered.keys()); // already nameKey'd
  for (const artist of session.graph.artists) known.add(nameKey(artist.artist));
  for (const seed of seeds) known.add(nameKey(seed));
  return known;
}

/**
 * Candidates worth offering, after subtracting what the user has rejected.
 *
 * "Suggest fewer artists like that one" has no Last.fm equivalent — there is no
 * negative query — so it becomes a subtraction: a disliked artist's whole
 * neighbourhood is off-limits. That works fine when a round went well and falls
 * apart when it didn't, because with four dislikes the vetoed neighbourhoods can
 * cover most of the reachable graph. So the veto is a *preference*: if honouring
 * it in full leaves too little to ask about, we drop back to vetoing only the
 * artists actually swiped left. A round of imperfect candidates beats no round.
 */
function freshArtists(
  pool: SimilarArtist[],
  known: Set<string>,
  dislikedKeys: Set<string>,
  vetoedKeys: Set<string>,
): SimilarArtist[] {
  const unseen = pool.filter((a) => !known.has(nameKey(a.artist)));
  const strict = unseen.filter((a) => {
    const key = nameKey(a.artist);
    return !dislikedKeys.has(key) && !vetoedKeys.has(key);
  });
  if (strict.length >= MIN_FRESH) return strict;
  return unseen.filter((a) => !dislikedKeys.has(nameKey(a.artist)));
}

/**
 * Turn a chosen set of new artists into the next round: tracks → LLM → merged
 * graph → more cards.
 *
 * Shared by both ways a round can be triggered (a like-driven expansion and a
 * user-chosen pivot), which differ only in how they *pick* the artists. The
 * graph is rebuilt from the combined set of every round, never from this round
 * alone — that would drop everyone discovered earlier.
 *
 * `refineParams` is passed rather than read from props because a pivot can carry
 * overridden moods, and `deckAdventurousness` likewise, so the cards a pivot
 * deals are ordered on the same terms the pivot selected them by.
 */
async function commitRound(
  session: Session,
  newArtists: SimilarArtist[],
  feedback: SwipeFeedback,
  refineParams: SearchParams,
  deckAdventurousness: number,
  signal: AbortSignal,
): Promise<Session | null> {
  const names = newArtists.map((a) => a.artist);
  const [candidates, matrix] = await Promise.all([
    fetchTracksFor(names, signal),
    fetchMatrixFor(names, signal),
  ]);
  if (candidates.length === 0) return null;

  // One refine call for the whole round, with every verdict as context — far
  // better curation than a call per artist, and a fraction of the cost. Only
  // artists new to this round are in the pool, so no already-swiped song can
  // come back around; the exclusion is structural rather than a prompt rule.
  const newSongs = await refine(refineParams, candidates, feedback, signal);

  const discovered = new Map(session.discovered);
  for (const artist of newArtists) {
    discovered.set(nameKey(artist.artist), artist);
  }
  const songs = [...session.songs, ...newSongs];
  const matrixResponses = [...session.matrixResponses, ...matrix];
  const graph = buildTasteMapGraph(
    refineParams.artists,
    discovered.values(),
    songs,
    matrixResponses,
  );

  // Only artists this round surfaced get cards, so a round means what it says.
  // Passing everything previously on the map as "already shown" is what
  // restricts it, while still ranking against the full pool.
  const shown = knownKeys(session, refineParams.artists);
  const cards = selectDeck(
    graph.artists,
    deckAdventurousness,
    ROUND_CARDS,
    shown,
  );
  if (cards.length === 0) return null;

  return {
    songs,
    discovered,
    matrixResponses,
    graph,
    deck: [...session.deck, ...cards],
    roundStartIndex: session.deck.length,
  };
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
  const deck = selectDeck(graph.artists, params.adventurousness, ROUND_CARDS);

  return {
    songs,
    discovered,
    matrixResponses,
    graph,
    deck,
    roundStartIndex: 0,
  };
}

export default function SwipeFlow({ params }: SwipeFlowProps) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  // Swipe verdicts live here, not in SwipeDeck, because the taste map is built
  // from them once the deck runs out.
  const [verdicts, setVerdicts] = useState<Map<string, Verdict>>(new Map());
  const [flowPhase, setFlowPhaseState] = useState<FlowPhase>("swiping");
  /** Set when a round the user explicitly asked for came back with nothing. */
  const [pivotFailed, setPivotFailed] = useState(false);
  /** Moods the user re-picked mid-session, overriding the seed's. */
  const [moodOverride, setMoodOverride] = useState<Mood[] | null>(null);

  // Mirrors of the above, for the callbacks below. SwipeDeck calls onFinished
  // from an effect keyed on that callback's identity, so onFinished has to stay
  // referentially stable or it re-fires on every re-render while the deck is
  // done. Reading through refs is what keeps its dependency list empty.
  const sessionRef = useRef<Session | null>(null);
  const verdictsRef = useRef(new Map<string, Verdict>());
  const roundRef = useRef(1);
  /**
   * The authoritative phase. A ref rather than the state above because every
   * guard has to be closed *synchronously*, before the first await of an async
   * round — a state update lands too late to stop a second entry.
   */
  const phaseRef = useRef<FlowPhase>("swiping");
  /** Moods for refine calls. A ref so `expand` needn't depend on it — see below. */
  const moodOverrideRef = useRef<Mood[] | null>(null);
  /**
   * How far into each seed's similar list we've drawn. Round 1 consumed the first
   * SIMILAR_LIMIT, so that's where a pivot picks up.
   *
   * A ref rather than part of `Session` because it advances on every *attempt*,
   * including one that finds nothing — a spent window is spent, and leaving the
   * cursor put would mean a retry refetches the same artists, filters them out
   * against `known` again, and fails identically. That is a dead end the user
   * can't escape, which is the exact shape of bug this whole feature removes.
   */
  const seedCursorRef = useRef(SIMILAR_LIMIT);
  /** Similar-artist lists, requested the moment a card is swiped. By nameKey.
   *  Deliberately shallow-only: deep windows are keyed by artist too, so writing
   *  them here would let a later shallow read pick up a deep list. */
  const similarRef = useRef(new Map<string, Promise<SimilarArtist[]>>());
  const abortRef = useRef<AbortController | null>(null);

  const setFlowPhase = useCallback((next: FlowPhase) => {
    phaseRef.current = next; // ref first — the guard must close before any await
    setFlowPhaseState(next);
  }, []);

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

  /** The neighbourhoods of a set of artists, from the swipe-time prefetch. */
  const neighbourhoodKeys = useCallback(async (artists: string[]) => {
    const lists = await Promise.all(
      artists.map(
        (artist) =>
          similarRef.current.get(nameKey(artist)) ?? Promise.resolve([]),
      ),
    );
    const keys = new Set<string>();
    for (const list of lists) {
      for (const similar of list) keys.add(nameKey(similar.artist));
    }
    return keys;
  }, []);

  /**
   * The ordinary round: expand outward from the artists the user liked.
   *
   * Unchanged in substance from before — this is the healthy path, and a round
   * with likes in it still behaves exactly as it always did.
   */
  const expandFromLikes = useCallback(async (): Promise<Session | null> => {
    const session = sessionRef.current;
    const signal = abortRef.current?.signal;
    if (!session || !signal) return null;

    const { liked, disliked } = partitionVerdicts(
      session.deck,
      verdictsRef.current,
    );
    // Nothing liked means nothing to expand *from*. Reachable only for a round
    // too short to judge; a genuinely dislike-heavy round is intercepted before
    // this and handed to the user instead.
    if (liked.length === 0) return null;

    const listFor = (artist: string) =>
      similarRef.current.get(nameKey(artist)) ?? Promise.resolve([]);
    const likedLists = await Promise.all(liked.map(listFor));
    const vetoed = await neighbourhoodKeys(disliked);

    const pool = new Map<string, SimilarArtist>();
    for (const list of likedLists) {
      for (const similar of list) {
        const key = nameKey(similar.artist);
        const existing = pool.get(key);
        if (!existing || similar.match > existing.match) pool.set(key, similar);
      }
    }

    const fresh = freshArtists(
      [...pool.values()],
      knownKeys(session, params.artists),
      new Set(disliked.map(nameKey)),
      vetoed,
    );
    const newArtists = fresh
      .sort((a, b) => b.match - a.match)
      .slice(0, MAX_NEW_ARTISTS);
    if (newArtists.length === 0) return null;

    return commitRound(
      session,
      newArtists,
      { liked, disliked },
      { ...params, moods: moodOverrideRef.current ?? params.moods },
      params.adventurousness,
      signal,
    );
  }, [params, neighbourhoodKeys]);

  /**
   * The round the user asked for after rejecting most of a deck.
   *
   * Draws from further down each *seed's* own similar list rather than from
   * anything liked, because on this path there may be nothing liked at all. The
   * seeds remain the best evidence available — it was the songs that were
   * rejected, not the seeds — and the advancing cursor guarantees this window
   * holds artists no earlier round could have shown.
   */
  const runPivotRound = useCallback(
    async (direction: PivotDirection): Promise<Session | null> => {
      const session = sessionRef.current;
      const signal = abortRef.current?.signal;
      if (!session || !signal) return null;

      const { liked, disliked } = partitionVerdicts(
        session.deck,
        verdictsRef.current,
      );

      // Claim this window and move the cursor on before anything can fail, so a
      // retry always looks somewhere new.
      const skip = seedCursorRef.current;
      seedCursorRef.current = skip + SEED_WINDOW;

      const results = await Promise.allSettled(
        params.artists.map((artist) =>
          fetch(
            `/api/recommend/similar?artist=${encodeURIComponent(artist)}` +
              `&limit=${SEED_WINDOW}&skip=${skip}`,
            { signal },
          ).then((res) =>
            res.ok ? (res.json() as Promise<SimilarArtist[]>) : [],
          ),
        ),
      );

      const pool = new Map<string, SimilarArtist>();
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const similar of result.value) {
          const key = nameKey(similar.artist);
          const existing = pool.get(key);
          if (!existing || similar.match > existing.match) {
            pool.set(key, similar);
          }
        }
      }

      const fresh = freshArtists(
        [...pool.values()],
        knownKeys(session, params.artists),
        new Set(disliked.map(nameKey)),
        await neighbourhoodKeys(disliked),
      );
      if (fresh.length === 0) return null;

      const newArtists = selectPivotArtists(
        fresh,
        direction,
        params.adventurousness,
        MAX_NEW_ARTISTS,
      );
      if (newArtists.length === 0) return null;

      return commitRound(
        session,
        newArtists,
        { liked, disliked },
        { ...params, moods: moodOverrideRef.current ?? params.moods },
        pivotAdventurousness(direction, params.adventurousness),
        signal,
      );
    },
    [params, neighbourhoodKeys],
  );

  /**
   * Run a round and land somewhere definite. The only place the flow leaves
   * "expanding", so every outcome — including failure — has exactly one owner.
   *
   * `userAsked` is what makes a dead end recoverable: an auto-expansion that
   * finds nothing can quietly fall through to the map, but if the *user* picked a
   * direction, dropping them on the map is the very dead end this feature exists
   * to remove. That case re-opens the prompt instead.
   */
  const runRound = useCallback(
    (round: () => Promise<Session | null>, userAsked: boolean) => {
      setFlowPhase("expanding");
      round()
        .then((next) => {
          if (next) {
            roundRef.current += 1;
            sessionRef.current = next;
            setStatus({ phase: "ready", session: next });
            // Batched with setStatus, so `done` flips false in the same render
            // the guard re-opens — there is no frame where the deck is out of
            // cards *and* the flow considers itself swiping.
            setFlowPhase("swiping");
          } else if (userAsked) {
            setPivotFailed(true);
            setFlowPhase("awaiting");
          } else {
            setFlowPhase("done");
          }
        })
        .catch(() => {
          if (abortRef.current?.signal.aborted) return;
          // A failed round is not worth losing the map over — the user has
          // already swiped, and that is enough to place everyone.
          setFlowPhase("done");
        });
    },
    [setFlowPhase],
  );

  const handleFinished = useCallback(() => {
    // Running out of cards only means something while swiping.
    if (phaseRef.current !== "swiping") return;

    const session = sessionRef.current;
    if (!session) return;

    if (roundRef.current >= MAX_ROUNDS) {
      setFlowPhase("done");
      return;
    }

    // How the round just finished went — the *round*, not the session. Both the
    // deck and SwipeDeck's counters are cumulative, which is what this slice is
    // for.
    const round = session.deck.slice(session.roundStartIndex);
    const dislikes = round.filter(
      (song) => verdictsRef.current.get(songKey(song)) === "dislike",
    ).length;

    // Too short to read anything into: when the pool runs low a round can be one
    // or two cards, and a single dislike would trip the ratio on its own.
    if (round.length < MIN_ROUND_FOR_PIVOT) {
      setFlowPhase("done");
      return;
    }

    if (dislikes / round.length >= DISLIKE_HEAVY) {
      // Rejecting this much says the pool is wrong, but not which way to move —
      // obscurer and safer are opposite corrections and the swipes can't tell
      // them apart. So stop guessing and ask.
      setFlowPhase("awaiting");
      return;
    }

    runRound(expandFromLikes, false);
    // Every dependency here is referentially stable, and that is load-bearing:
    // SwipeDeck fires onFinished from an effect keyed [done, onFinished]
    // (SwipeDeck.tsx:43-45). If this identity changed while the deck was out of
    // cards, the effect would re-fire and re-enter a round on every render.
  }, [expandFromLikes, runRound, setFlowPhase]);

  const handlePivot = useCallback(
    (direction: PivotDirection) => {
      if (phaseRef.current !== "awaiting") return; // double-tap
      setPivotFailed(false);
      runRound(() => runPivotRound(direction), true);
    },
    [runPivotRound, runRound],
  );

  const handleToggleMood = useCallback(
    (mood: Mood) => {
      const current = moodOverrideRef.current ?? params.moods;
      const next = current.includes(mood)
        ? current.filter((m) => m !== mood)
        : [...current, mood];
      moodOverrideRef.current = next; // the ref is what `expand` reads
      setMoodOverride(next);
    },
    [params.moods],
  );

  const handleShowMap = useCallback(
    () => setFlowPhase("done"),
    [setFlowPhase],
  );

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

  if (flowPhase === "done") {
    return (
      <TasteMap
        graph={status.session.graph}
        verdicts={verdicts}
        adventurousness={params.adventurousness}
      />
    );
  }

  const round = status.session.deck.slice(status.session.roundStartIndex);
  const roundDislikes = round.filter(
    (song) => verdicts.get(songKey(song)) === "dislike",
  ).length;

  // SwipeDeck stays mounted across expansions *and* across the interstitial — it
  // owns the card index, and unmounting it would replay the deck from card one.
  // So the prompt is a sibling <dialog>, never a replacement. Both children are
  // unconditional, which keeps the child list positionally stable; the dialog is
  // display:none until it opens itself.
  return (
    <>
      <SwipeDeck
        songs={status.session.deck}
        verdicts={verdicts}
        onVerdict={handleVerdict}
        onFinished={handleFinished}
        doneMessage={
          flowPhase === "expanding"
            ? "Finding more for you…"
            : flowPhase === "awaiting"
              ? // The dialog is asking a question; don't narrate a contradictory
                // answer from behind it.
                ""
              : "Building your taste map…"
        }
      />
      <PivotPrompt
        open={flowPhase === "awaiting"}
        disliked={roundDislikes}
        total={round.length}
        failed={pivotFailed}
        moods={moodOverride ?? params.moods}
        onToggleMood={handleToggleMood}
        onChoose={handlePivot}
        onShowMap={handleShowMap}
      />
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
