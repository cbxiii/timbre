import { nameKey } from "@/lib/tasteMapGraph";
import { popularityBias, popularityRanks } from "@/lib/tasteMapLayout";
import type { MapArtist, RecommendedSongWithDesc } from "@/lib/types";

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
