export const MOODS = ["chill", "energetic", "melancholic", "hype"] as const;

export type Mood = (typeof MOODS)[number];

/** The seed a user provides on the first screen, handed off to the discovery flow. */
export interface SearchParams {
  artists: string[];
  moods: Mood[];
  /** 0 = familiar, 100 = surprising. */
  adventurousness: number;
}

/** An artist suggestion returned by `/api/artists/search` (from Last.fm artist.search). */
export interface ArtistSuggestion {
  name: string;
  /** Global listener count, from artist.search. */
  listenerCount: number;
}

/** A similar artist returned by `/api/recommend/similar` (from Last.fm artist.getSimilar + getInfo). */
export interface SimilarArtist {
  artist: string;
  /** 0–1 similarity score from artist.getSimilar. */
  match: number;
  /** Global listener count, from artist.getInfo. */
  listenerCount: number;
  /** Top tags, from artist.getInfo. */
  tags: string[];
}

/** A recommended track returned by `/api/recommend/top-tracks` (from Last.fm artist.getTopTracks + track.getInfo). */
export interface RecommendedTrack {
  title: string;
  artist: string;
  /** Global listener count, from artist.getTopTracks. */
  listenerCount: number;
  /** Top tags, from track.getInfo. */
  tags: string[];
}

/** The body POSTed to `/api/recommend/refine`: the user's seed params plus the
 * candidate pool the client assembled from `/similar` + `/top-tracks`. */
export interface RefineRequest {
  params: SearchParams;
  candidates: RecommendedTrack[];
}

/**
 * A curated track from the LLM refine step (`/api/recommend/refine`): a
 * candidate `RecommendedTrack` plus the LLM's "why it fits" blurb and a link to
 * listen. `description` comes from the LLM; `link` is attached by our code.
 */
export interface RecommendedSongWithDesc extends RecommendedTrack {
  /** LLM-written explanation of why this song fits the seed/mood. */
  description: string;
  /** Link to listen to the track (a YouTube search URL for now). */
  link: string;
}
