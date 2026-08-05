import { buildLinks, buildMatchMap } from "@/lib/similarity";
import type {
  MapArtist,
  RecommendedSongWithDesc,
  SimilarArtist,
  TasteMapGraph,
} from "@/lib/types";

/**
 * Assembly of the taste map graph from what the discovery pipeline gathered.
 * Pure — no React, no fetch — so SwipeFlow stays pure orchestration.
 */

export function nameKey(artist: string): string {
  return artist.trim().toLowerCase();
}

/** A `/api/recommend/similar-names` response, tagged with who it was asked about. */
export interface MatrixResponse {
  artist: string;
  similar: Array<{ artist: string; match: number }>;
}

export function buildTasteMapGraph(
  seedArtists: string[],
  discovered: Iterable<SimilarArtist>,
  songs: RecommendedSongWithDesc[],
  matrixResponses: MatrixResponse[]
): TasteMapGraph {
  const songsByArtist = new Map<string, RecommendedSongWithDesc[]>();
  for (const song of songs) {
    const key = nameKey(song.artist);
    const list = songsByArtist.get(key);
    if (list) list.push(song);
    else songsByArtist.set(key, [song]);
  }

  const artists: MapArtist[] = [];

  // Seeds anchor the center. They carry no tags on purpose: their lateral
  // position is irrelevant at radius ~0, and their edges come from seedMatch.
  for (const seed of seedArtists) {
    artists.push({
      artist: seed,
      isSeed: true,
      seedMatch: 1,
      listenerCount: 0,
      tags: [],
      songs: songsByArtist.get(nameKey(seed)) ?? [],
    });
  }

  for (const similar of discovered) {
    artists.push({
      artist: similar.artist,
      isSeed: false,
      seedMatch: similar.match,
      listenerCount: similar.listenerCount,
      tags: similar.tags,
      songs: songsByArtist.get(nameKey(similar.artist)) ?? [],
    });
  }

  // Last.fm autocorrect can credit a track to a slightly different artist name
  // than the one we asked about. Add those so every curated song is reachable on
  // the map; with no similarity score they sit at the outer edge until swipe
  // verdicts say otherwise.
  const placed = new Set(artists.map((a) => nameKey(a.artist)));
  for (const [key, group] of songsByArtist) {
    if (placed.has(key)) continue;
    artists.push({
      artist: group[0].artist,
      isSeed: false,
      seedMatch: 0,
      listenerCount: group[0].listenerCount,
      tags: group[0].tags,
      songs: group,
    });
  }

  const matches = buildMatchMap(
    matrixResponses,
    artists.map((a) => a.artist)
  );

  return { artists, links: buildLinks(artists, matches) };
}
