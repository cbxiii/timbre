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

/**
 * What the user's swipes said so far, by artist. Sent to the refine step on the
 * expansion round so the curation is steered by real verdicts, not just the seed.
 */
export interface SwipeFeedback {
  /** Artists whose card was swiped right. */
  liked: string[];
  /** Artists whose card was swiped left. */
  disliked: string[];
}

/** The body POSTed to `/api/recommend/refine`: the user's seed params plus the
 * candidate pool the client assembled from `/similar` + `/top-tracks`. */
export interface RefineRequest {
  params: SearchParams;
  candidates: RecommendedTrack[];
  /** Absent on the first round — there is nothing swiped to learn from yet. */
  feedback?: SwipeFeedback;
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

/** A swipe outcome for a single song. */
export type Verdict = "like" | "dislike";

/**
 * An artist node on the taste map.
 *
 * Seed artists deliberately carry no tags: they sit at the center, so their
 * lateral position is irrelevant, and their links to everything else come from
 * `seedMatch`. That saves an artist.getInfo call per seed.
 */
export interface MapArtist {
  artist: string;
  /** True for the 1–3 artists the user typed. */
  isSeed: boolean;
  /** Best 0–1 Last.fm match against any seed; 1 for seeds themselves. */
  seedMatch: number;
  /**
   * Global listener count, from artist.getInfo. 0 means "unknown" — seeds, and
   * any artist we never ran getInfo on — and the popularity tilt skips those.
   */
  listenerCount: number;
  /** Top tags, from artist.getInfo. Empty for seeds. */
  tags: string[];
  /**
   * Curated songs by this artist from the refine step. Always non-empty for
   * discovered artists — one is the price of admission to the map — and empty
   * for seeds, which are never expanded for candidates of their own.
   */
  songs: RecommendedSongWithDesc[];
}

/** Blended pairwise similarity between two map artists, keyed by artist name. */
export interface ArtistLink {
  source: string;
  target: string;
  /** 0–1: Last.fm match where known, IDF-weighted tag overlap elsewhere. */
  sim: number;
}

/** Everything the taste map needs to lay itself out. */
export interface TasteMapGraph {
  artists: MapArtist[];
  links: ArtistLink[];
}
