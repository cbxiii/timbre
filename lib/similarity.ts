import type { ArtistLink, MapArtist } from "@/lib/types";

/**
 * Pairwise similarity between map artists, blended from two sources that fail in
 * opposite ways: Last.fm's `match` is high quality but *sparse* (most pairs in a
 * pool have no entry at all), while tag overlap is *dense* but noisy. Using both
 * gives a complete matrix where the better signal wins wherever it exists.
 */

/** Pairs weaker than this are dropped entirely. */
export const LINK_THRESHOLD = 0.15;

/**
 * Max links kept per node; the final set is the union of each node's top N.
 * Without this a ~15-node graph is near fully-connected and collapses to a blob.
 */
export const MAX_DEGREE = 4;

/** Weight on the Last.fm signal for pairs where both signals are present. */
const LASTFM_WEIGHT = 0.7;

/** Tag-only pairs are discounted — tag overlap alone is the weaker evidence. */
const TAG_ONLY_WEIGHT = 0.5;

/** Order-independent key for a pair of artist names. */
export function pairKey(a: string, b: string): string {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  return `${x}|${y}`;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Fold `/api/recommend/similar-names` responses into a symmetric match map.
 *
 * artist.getSimilar is asymmetric — B can appear in A's list without the
 * reverse — so where both directions exist we keep the stronger one. Pairs
 * involving an artist that isn't on the map are dropped.
 */
export function buildMatchMap(
  responses: Array<{ artist: string; similar: Array<{ artist: string; match: number }> }>,
  onMap: Iterable<string>
): Map<string, number> {
  const known = new Set([...onMap].map((n) => n.trim().toLowerCase()));
  const matches = new Map<string, number>();

  for (const { artist, similar } of responses) {
    if (!known.has(artist.trim().toLowerCase())) continue;
    for (const entry of similar) {
      if (!known.has(entry.artist.trim().toLowerCase())) continue;
      const key = pairKey(artist, entry.artist);
      const existing = matches.get(key);
      if (existing === undefined || entry.match > existing) {
        matches.set(key, entry.match);
      }
    }
  }

  return matches;
}

/**
 * Build the sparse link set for the taste map.
 *
 * `lastfmMatches` is the symmetric map from `buildMatchMap`; every pair it
 * doesn't cover falls back to IDF-weighted tag overlap.
 */
export function buildLinks(
  artists: MapArtist[],
  lastfmMatches: Map<string, number>
): ArtistLink[] {
  const tagSets = new Map<string, Set<string>>();
  const docFreq = new Map<string, number>();

  for (const a of artists) {
    const tags = new Set(a.tags.map(normalizeTag).filter(Boolean));
    tagSets.set(a.artist, tags);
    for (const tag of tags) {
      docFreq.set(tag, (docFreq.get(tag) ?? 0) + 1);
    }
  }

  // Rare tags carry far more signal than ubiquitous ones: two artists sharing
  // "shoegaze" tells you much more than two sharing "indie", which half the
  // pool carries. Smoothed so the weight is always positive — an unsmoothed
  // log(n / df) goes to zero (or negative) for a tag on every artist, which
  // would silently invert the comparison.
  const idf = (tag: string) =>
    Math.log((artists.length + 1) / (1 + (docFreq.get(tag) ?? 0))) + 1;

  /** Jaccard over tag sets, with each tag weighted by its IDF. */
  const tagSimilarity = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    let union = 0;
    for (const tag of a) {
      const w = idf(tag);
      union += w;
      if (b.has(tag)) shared += w;
    }
    for (const tag of b) {
      if (!a.has(tag)) union += idf(tag);
    }
    return union === 0 ? 0 : shared / union;
  };

  const candidates: ArtistLink[] = [];
  for (let i = 0; i < artists.length; i++) {
    for (let j = i + 1; j < artists.length; j++) {
      const a = artists[i];
      const b = artists[j];
      const tagSim = tagSimilarity(
        tagSets.get(a.artist) ?? new Set(),
        tagSets.get(b.artist) ?? new Set()
      );
      const match = lastfmMatches.get(pairKey(a.artist, b.artist));
      const sim =
        match !== undefined
          ? LASTFM_WEIGHT * match + (1 - LASTFM_WEIGHT) * tagSim
          : TAG_ONLY_WEIGHT * tagSim;

      if (sim >= LINK_THRESHOLD) {
        candidates.push({ source: a.artist, target: b.artist, sim });
      }
    }
  }

  // Sparsify to the union of each node's strongest links. Links are shared by
  // reference between the two nodes they touch, so a Set dedupes them.
  const byNode = new Map<string, ArtistLink[]>();
  for (const link of candidates) {
    for (const name of [link.source, link.target]) {
      const list = byNode.get(name);
      if (list) list.push(link);
      else byNode.set(name, [link]);
    }
  }

  const kept = new Set<ArtistLink>();
  for (const list of byNode.values()) {
    list.sort((a, b) => b.sim - a.sim);
    for (const link of list.slice(0, MAX_DEGREE)) kept.add(link);
  }

  return [...kept].sort((a, b) => b.sim - a.sim);
}
