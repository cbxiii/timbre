export const MOODS = ["chill", "energetic", "melancholic", "hype"] as const;

export type Mood = (typeof MOODS)[number];

/** The seed a user provides on the first screen, handed off to the discovery flow. */
export interface SearchParams {
  artists: string[];
  moods: Mood[];
  /** 0 = familiar, 100 = surprising. */
  adventurousness: number;
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
