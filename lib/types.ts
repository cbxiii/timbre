export const MOODS = ["chill", "energetic", "melancholic", "hype"] as const;

export type Mood = (typeof MOODS)[number];

/** The seed a user provides on the first screen, handed off to the discovery flow. */
export interface SearchParams {
  artists: string[];
  moods: Mood[];
  /** 0 = familiar, 100 = surprising. */
  adventurousness: number;
}
