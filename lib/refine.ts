import { callLLM } from "@/lib/ai";
import type {
  SearchParams,
  RecommendedTrack,
  RecommendedSongWithDesc,
} from "./types";
import { youtubeSearchUrl } from "./youtube";

export class RefineError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message);
    this.name = "RefineError";
  }
}

/** What we ask the LLM to return per song — nothing pool-derived, just its picks. */
interface LLMPick {
  title: string;
  artist: string;
  description: string;
}

/** Normalize for matching a pick back to a candidate (tune strictness here). */
function matchKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|||${title.trim().toLowerCase()}`;
}

export async function refineRecommendations(
  params: SearchParams,
  candidates: RecommendedTrack[]
): Promise<RecommendedSongWithDesc[]> {
  if (candidates.length === 0) {
    throw new RefineError("No candidate songs to refine", 400);
  }

  // 1. Build the prompt. YOU: tune this wording — it drives curation quality.
  //    Give the LLM the user's intent + the candidate menu, and demand a JSON
  //    array of {title, artist, description}, picking ONLY from the candidates.
  const prompt = JSON.stringify({
    seedArtists: params.artists,
    moods: params.moods,
    adventurousness: params.adventurousness,
    candidates: candidates.map((c) => ({
      title: c.title,
      artist: c.artist,
      tags: c.tags,
    })),
  });
  const systemPrompt =
    "You curate a song playlist. Pick the songs from the provided candidates " +
    "that best fit the seed artists, moods, and adventurousness. For each, write " +
    "a one-sentence reason it fits. Respond with ONLY a JSON array of objects " +
    "{title, artist, description}. Use titles/artists exactly as given. No prose.";

  // 2. Call the LLM (callLLM returns a string).
  let raw: string;
  try {
    raw = await callLLM(prompt, 1500, systemPrompt);
  } catch (cause) {
    throw new RefineError(`LLM request failed: ${(cause as Error).message}`);
  }

  // 3. Parse the string into JSON.
  let picks: unknown;
  try {
    picks = JSON.parse(raw);
  } catch {
    throw new RefineError("LLM did not return valid JSON");
  }
  if (!Array.isArray(picks)) {
    throw new RefineError("LLM response was not a JSON array");
  }

  // 4. Validate each pick against the pool; drop hallucinations; attach
  //    pool-derived fields (tags, listenerCount) + the listen link.
  const byKey = new Map(candidates.map((c) => [matchKey(c.artist, c.title), c]));
  const refined: RecommendedSongWithDesc[] = [];
  for (const pick of picks as LLMPick[]) {
    if (
      !pick ||
      typeof pick.title !== "string" ||
      typeof pick.artist !== "string"
    ) {
      continue;
    }
    const match = byKey.get(matchKey(pick.artist, pick.title));
    if (!match) continue; // not in the candidate pool → drop it
    refined.push({
      ...match, // title, artist, listenerCount, tags
      description: typeof pick.description === "string" ? pick.description : "",
      link: youtubeSearchUrl(match.artist, match.title),
    });
  }

  if (refined.length === 0) {
    throw new RefineError("LLM returned no usable songs");
  }
  return refined;
}
