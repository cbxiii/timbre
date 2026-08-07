import { nameKey } from "@/lib/tasteMapGraph";
import { popularityBias, popularityRanks } from "@/lib/tasteMapLayout";
import type {
  MapArtist,
  RecommendedSongWithDesc,
  SimilarArtist,
} from "@/lib/types";

/**
 * Choosing which songs actually reach the swipe deck.
 *
 * The refine step returns up to three tracks per artist and the map holds a
 * dozen-odd artists, which is far more than anyone wants to swipe through. The
 * deck is therefore a *sample* of the pool, not the whole of it: one card per
 * artist, and only the strongest few artists per round. Everything left over
 * still reaches the map — it just gets placed by its prior instead of by a
 * verdict.
 *
 * Deliberately pure: no React, no fetch, no DOM.
 *
 * A separate module from `tasteMapGraph` on purpose. This needs the layout's
 * popularity helpers, and `lib/refine.ts` imports `nameKey` from `tasteMapGraph`
 * — folding this in there would pull `d3-force` into the server bundle along
 * that path.
 */

/** The artist's most-played curated track: the fairest single sample of them. */
function bestSong(artist: MapArtist): RecommendedSongWithDesc {
  return artist.songs.reduce((best, song) =>
    song.listenerCount > best.listenerCount ? song : best
  );
}

/**
 * Pick the next `count` cards: one song each, from the artists whose prior says
 * they fit best.
 *
 * Ranking by the *popularity-tilted* prior rather than raw `seedMatch` is what
 * makes adventurousness affect discovery and not just geometry. At adv=0 the
 * recognisable artists get asked about first; at adv=100 the deep cuts do; at 50
 * the tilt is zero and this is a plain seed-similarity ordering.
 *
 * `alreadyShown` holds `nameKey`s of artists that have had their card, which is
 * what keeps an artist to one appearance across the whole session — including
 * across rounds.
 *
 * The prior is left unclamped: clamping would tie every artist at seedMatch 1.0
 * regardless of tilt, and here the ordering is the entire point.
 */
export function selectDeck(
  artists: MapArtist[],
  adventurousness: number,
  count: number,
  alreadyShown: Set<string> = new Set()
): RecommendedSongWithDesc[] {
  // Ranked over the whole pool, matching the layout: a percentile only means
  // anything relative to the other artists on this map.
  const ranks = popularityRanks(artists);

  return artists
    .filter(
      (artist) =>
        !artist.isSeed &&
        artist.songs.length > 0 &&
        !alreadyShown.has(nameKey(artist.artist))
    )
    .map((artist) => ({
      artist,
      prior:
        artist.seedMatch +
        popularityBias(ranks.get(artist.artist), adventurousness),
    }))
    // Name as the tie-break so an unlucky pool of equal priors still deals a
    // stable deck rather than one that depends on fetch ordering.
    .sort((a, b) => b.prior - a.prior || a.artist.artist.localeCompare(b.artist.artist))
    .slice(0, count)
    .map(({ artist }) => bestSong(artist));
}

/**
 * Which way to lean when the user has rejected most of what they were shown.
 *
 * A round of dislikes says "not these" but not *which way* to move, so the user
 * picks: `obscure` and `familiar` are the two directions along the popularity
 * axis, and `vibe` means "same reach, different feel" — the mood changed
 * instead, so the user's own dial is left alone.
 */
export type PivotDirection = "obscure" | "familiar" | "vibe";

/** The dial each direction stands in for, on the same 0–100 scale as the slider. */
const PIVOT_ADVENTUROUSNESS: Record<PivotDirection, number | null> = {
  obscure: 85,
  familiar: 15,
  vibe: null, // keep whatever the user set
};

/**
 * How hard popularity leans on a directional pivot.
 *
 * Far above the map's default tilt, and deliberately: the default is sized to
 * nudge a radius that seed similarity should still own, whereas here the user has
 * said "lesser-known" in as many words. At the default the tilt spans ±0.105 and
 * would routinely lose to the spread in `match` across a candidate window — the
 * pivot would be a no-op the user can see through. This makes popularity the
 * deciding term while keeping `match` as the tiebreak among equals.
 */
const PIVOT_POPULARITY_WEIGHT = 0.4;

/** The effective dial for a pivot round — exported so the deck and the artist
 *  selection for that round are ranked on identical terms. */
export function pivotAdventurousness(
  direction: PivotDirection,
  baseAdventurousness: number
): number {
  return PIVOT_ADVENTUROUSNESS[direction] ?? baseAdventurousness;
}

/**
 * Pick which of a freshly-fetched similar-artist window to actually pull tracks
 * for, ranked by the pivot direction.
 *
 * Deliberately the *same* scoring shape as `selectDeck` above — Last.fm match
 * plus a popularity tilt — rather than a second obscurity rule. The tilt is the
 * whole mechanism here: the window comes from further down the seed's similar
 * list, which is fresher but not inherently more or less popular (getSimilar
 * orders by match, not by listeners), so ranking within the window is what
 * actually delivers "deeper cuts" or "safer picks".
 *
 * Ranks are computed over the window alone, which is the right frame: a
 * percentile only means anything relative to the candidates being chosen among.
 */
export function selectPivotArtists(
  window: SimilarArtist[],
  direction: PivotDirection,
  baseAdventurousness: number,
  count: number
): SimilarArtist[] {
  const adventurousness = pivotAdventurousness(direction, baseAdventurousness);
  const ranks = popularityRanks(window);
  // "Different vibe" makes no claim about popularity — the mood changed instead —
  // so it keeps the gentle default rather than shoving the window around an axis
  // the user didn't ask about.
  const weight = direction === "vibe" ? undefined : PIVOT_POPULARITY_WEIGHT;

  return window
    .map((candidate) => ({
      candidate,
      score:
        candidate.match +
        popularityBias(ranks.get(candidate.artist), adventurousness, weight),
    }))
    // Name as the tie-break, matching `selectDeck`: a pool of equal scores
    // should still yield a stable choice rather than one that depends on the
    // order the fetches happened to resolve in.
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.artist.localeCompare(b.candidate.artist)
    )
    .slice(0, count)
    .map(({ candidate }) => candidate);
}
