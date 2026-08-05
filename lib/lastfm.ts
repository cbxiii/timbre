import type {
  ArtistSuggestion,
  SimilarArtist,
  RecommendedTrack,
} from "@/lib/types";

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";

/** Number of tags we keep per item. */
const MAX_TAGS = 5;

/** Thrown when Last.fm returns an HTTP error or an in-body error payload. */
export class LastfmError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message);
    this.name = "LastfmError";
  }
}

/**
 * Call a Last.fm API method and return the parsed JSON body.
 *
 * Last.fm frequently returns its `{ error, message }` payload with an HTTP 200,
 * so we check both the HTTP status and the body.
 */
async function lastfmFetch<T>(
  method: string,
  params: Record<string, string | number>
): Promise<T> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    throw new LastfmError("LASTFM_API_KEY is not configured", 500);
  }

  const url = new URL(LASTFM_BASE);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    // Cache upstream responses for an hour to cut API calls; the data is slow-moving.
    res = await fetch(url, { next: { revalidate: 3600 } });
  } catch (cause) {
    throw new LastfmError(
      `Failed to reach Last.fm: ${(cause as Error).message}`
    );
  }

  if (!res.ok) {
    throw new LastfmError(`Last.fm responded with HTTP ${res.status}`, 502);
  }

  const json = (await res.json()) as T & { error?: number; message?: string };
  if (json.error) {
    throw new LastfmError(json.message ?? `Last.fm error ${json.error}`, 502);
  }

  return json;
}

// --- Raw Last.fm response shapes (only the fields we read) ---

interface RawTag {
  name: string;
}

interface RawArtistSearchResponse {
  results?: {
    artistmatches?: {
      artist?: Array<{ name: string; listeners: string }>;
    };
  };
}

interface RawSimilarResponse {
  similarartists?: {
    artist?: Array<{ name: string; match: string }>;
  };
}

interface RawArtistInfoResponse {
  artist?: {
    stats?: { listeners?: string };
    tags?: { tag?: RawTag[] };
  };
}

interface RawTopTracksResponse {
  toptracks?: {
    track?: Array<{
      name: string;
      listeners: string;
      artist?: { name: string };
    }>;
  };
}

interface RawTrackInfoResponse {
  track?: {
    toptags?: { tag?: RawTag[] };
  };
}

function toNumber(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isNaN(n) ? 0 : n;
}

function toTags(tags: RawTag[] | undefined): string[] {
  return (tags ?? []).slice(0, MAX_TAGS).map((t) => t.name);
}

/** Fetch the global listener count and top tags for a single artist. */
async function getArtistInfo(
  artist: string
): Promise<{ listenerCount: number; tags: string[] }> {
  const data = await lastfmFetch<RawArtistInfoResponse>("artist.getInfo", {
    artist,
  });
  return {
    listenerCount: toNumber(data.artist?.stats?.listeners),
    tags: toTags(data.artist?.tags?.tag),
  };
}

/** Fetch the top tags for a single track. */
async function getTrackTags(artist: string, track: string): Promise<string[]> {
  const data = await lastfmFetch<RawTrackInfoResponse>("track.getInfo", {
    artist,
    track,
  });
  return toTags(data.track?.toptags?.tag);
}

/**
 * Artists whose names match `query`, for the seed-screen typeahead.
 *
 * Unlike the functions below there is deliberately no per-result enrichment
 * fan-out: this runs on keystrokes, and artist.search already returns the
 * listener count we display. Last.fm's raw ordering is noisy and repeats names
 * across mbids, so we dedupe by name and re-rank by popularity.
 */
export async function searchArtists(
  query: string,
  limit: number
): Promise<ArtistSuggestion[]> {
  const data = await lastfmFetch<RawArtistSearchResponse>("artist.search", {
    artist: query,
    limit,
  });
  const matches = data.results?.artistmatches?.artist ?? [];

  const byName = new Map<string, ArtistSuggestion>();
  for (const match of matches) {
    const name = match.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, { name, listenerCount: toNumber(match.listeners) });
  }

  return [...byName.values()]
    .sort((a, b) => b.listenerCount - a.listenerCount)
    .slice(0, limit);
}

/**
 * Similar artists to `artist`, enriched with each artist's listener count and tags.
 * Enrichment is an N+1 fan-out (one artist.getInfo per result), run in parallel.
 */
export async function getSimilarArtists(
  artist: string,
  limit: number
): Promise<SimilarArtist[]> {
  const data = await lastfmFetch<RawSimilarResponse>("artist.getSimilar", {
    artist,
    limit,
  });
  const similar = data.similarartists?.artist ?? [];

  return Promise.all(
    similar.map(async (a) => {
      const info = await getArtistInfo(a.name);
      return {
        artist: a.name,
        match: Number.parseFloat(a.match) || 0,
        listenerCount: info.listenerCount,
        tags: info.tags,
      };
    })
  );
}

/**
 * Top tracks for `artist`, enriched with each track's tags.
 * Enrichment is an N+1 fan-out (one track.getInfo per result), run in parallel.
 */
export async function getTopTracks(
  artist: string,
  limit: number
): Promise<RecommendedTrack[]> {
  const data = await lastfmFetch<RawTopTracksResponse>("artist.getTopTracks", {
    artist,
    limit,
  });
  const tracks = data.toptracks?.track ?? [];

  return Promise.all(
    tracks.map(async (t) => {
      const trackArtist = t.artist?.name ?? artist;
      return {
        title: t.name,
        artist: trackArtist,
        listenerCount: toNumber(t.listeners),
        tags: await getTrackTags(trackArtist, t.name),
      };
    })
  );
}
