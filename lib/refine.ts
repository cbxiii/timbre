import { callLLM } from "@/lib/ai";
import { nameKey } from "@/lib/tasteMapGraph";
import type {
  SearchParams,
  RecommendedTrack,
  RecommendedSongWithDesc,
  SwipeFeedback,
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

/**
 * The blurb on a song we added ourselves to keep its artist on the map. The LLM
 * never saw it, so this must not read like curation — it states a fact instead.
 */
function fallbackDescription(artist: string): string {
  return `Their most-played track — a starting point for ${artist}'s sound.`;
}

/**
 * Salvage picks from a truncated response. Asking for full artist coverage makes
 * a cut-off array likelier, and `JSON.parse` on one yields nothing at all — so
 * on that path we scan out whatever complete `{...}` objects did arrive and drop
 * only the final partial one. Quote- and escape-aware, since descriptions are
 * free text and can contain braces.
 */
function salvageObjects(raw: string): unknown[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          found.push(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          // Skip anything that still doesn't parse on its own.
        }
        start = -1;
      }
    }
  }

  return found;
}

export async function refineRecommendations(
  params: SearchParams,
  candidates: RecommendedTrack[],
  feedback?: SwipeFeedback
): Promise<RecommendedSongWithDesc[]> {
  if (candidates.length === 0) {
    throw new RefineError("No candidate songs to refine", 400);
  }

  // 1. Group the pool by artist. Every artist on the taste map needs at least
  //    one song, so the artist — not the song — is the unit of coverage: a flat
  //    list of ~60 songs hides the artist set from the model entirely. The same
  //    groups drive the backfill in step 5. Keyed with the graph's own `nameKey`
  //    so coverage is measured exactly as the map will join it.
  const groups = new Map<string, { artist: string; tracks: RecommendedTrack[] }>();
  for (const candidate of candidates) {
    const key = nameKey(candidate.artist);
    const group = groups.get(key);
    if (group) group.tracks.push(candidate);
    else groups.set(key, { artist: candidate.artist, tracks: [candidate] });
  }

  // 2. Build the prompt. YOU: tune this wording — it drives curation quality.
  //    Give the LLM the user's intent + the candidate menu, and demand a JSON
  //    array of {title, artist, description}, picking ONLY from the candidates.
  const hasFeedback = Boolean(
    feedback && (feedback.liked.length > 0 || feedback.disliked.length > 0)
  );
  const prompt = JSON.stringify({
    seedArtists: params.artists,
    moods: params.moods,
    adventurousness: params.adventurousness,
    // Only present on the expansion round. These are artists the user has
    // actually swiped on, which is far stronger evidence than the seed.
    ...(hasFeedback
      ? {
          userLiked: feedback!.liked,
          userDisliked: feedback!.disliked,
        }
      : {}),
    artists: [...groups.values()].map((group) => ({
      artist: group.artist,
      tracks: group.tracks.map((t) => ({ title: t.title, tags: t.tags })),
    })),
  });
  const systemPrompt =
    "You curate a song playlist from a menu of artists and their candidate " +
    "tracks. Pick the tracks that best fit the seed artists, moods, and " +
    "adventurousness. You MUST include at least one track from EVERY artist " +
    "listed — pick their best fit even for a weak one — and up to three from " +
    "artists that fit especially well. For each, write a one-sentence reason it " +
    "fits. " +
    (hasFeedback
      ? "The user has already swiped on some artists: `userLiked` and " +
        "`userDisliked` record the verdicts. Treat these as stronger evidence " +
        "than the seed artists — lean toward what the liked artists have in " +
        "common, and away from what characterises the disliked ones. Where a " +
        "candidate resembles a disliked artist, prefer its least similar track " +
        "and say so plainly in the description. "
      : "") +
    "Respond with ONLY a JSON array of objects {title, artist, " +
    "description}. Use titles/artists exactly as given. No prose.";

  // 3. Call the LLM (callLLM returns a string). The token ceiling has to clear
  //    full coverage: ~12 artists at up to 3 picks each, ~45 tokens per object.
  let raw: string;
  try {
    raw = await callLLM(prompt, 3000, systemPrompt);
  } catch (cause) {
    throw new RefineError(`LLM request failed: ${(cause as Error).message}`);
  }

  // 4. Parse the string into JSON, falling back to a scan for complete objects
  //    so a truncated array costs us its tail rather than the whole response.
  let picks: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new RefineError("LLM response was not a JSON array");
    }
    picks = parsed;
  } catch (cause) {
    if (cause instanceof RefineError) throw cause;
    picks = salvageObjects(raw);
    if (picks.length === 0) {
      throw new RefineError("LLM did not return valid JSON");
    }
  }

  // 5. Validate each pick against the pool; drop hallucinations; attach
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

  // 6. Backfill the artists the picks missed. The instruction in step 2 is a
  //    request, not a guarantee: the model can skip an artist, and exact-string
  //    validation above silently drops a pick it reformatted ("Song" for "Song -
  //    Remastered 2011"). Either way the artist would reach the map with nothing
  //    to click, so give it its most-played candidate. This is what actually
  //    makes coverage an invariant.
  const covered = new Set(refined.map((song) => nameKey(song.artist)));
  for (const [key, group] of groups) {
    if (covered.has(key)) continue;
    const pick = group.tracks.reduce((best, track) =>
      track.listenerCount > best.listenerCount ? track : best,
    );
    refined.push({
      ...pick,
      description: fallbackDescription(pick.artist),
      link: youtubeSearchUrl(pick.artist, pick.title),
    });
  }

  return refined;
}
