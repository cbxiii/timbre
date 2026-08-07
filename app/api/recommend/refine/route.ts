import { NextResponse } from "next/server";
import {
  MOODS,
  type Mood,
  type RefineRequest,
  type SearchParams,
  type RecommendedTrack,
  type SwipeFeedback,
} from "@/lib/types";
import { RefineError, refineRecommendations } from "@/lib/refine";

/** A 400 with a consistent shape, so every validation failure looks the same. */
function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Narrow an arbitrary candidate to RecommendedTrack — the route trusts the
 * client to have built these from /top-tracks, so we only check the fields
 * refineRecommendations actually reads. */
function isRecommendedTrack(v: unknown): v is RecommendedTrack {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.title === "string" && typeof t.artist === "string";
}

/**
 * Narrow the optional swipe feedback. Absent is valid — the first round has
 * nothing swiped yet — but a malformed shape is not, since it would reach the
 * prompt verbatim.
 */
function isSwipeFeedback(v: unknown): v is SwipeFeedback {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  const names = (x: unknown) =>
    Array.isArray(x) && x.every((n) => typeof n === "string");
  return names(f.liked) && names(f.disliked);
}

/** Narrow the seed params: 1–3 artists, known moods, adventurousness 0–100. */
function isSearchParams(v: unknown): v is SearchParams {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const artistsOk =
    Array.isArray(p.artists) &&
    p.artists.length >= 1 &&
    p.artists.length <= 3 &&
    p.artists.every((a) => typeof a === "string" && a.trim().length > 0);
  const moodsOk =
    Array.isArray(p.moods) &&
    p.moods.every((m) => MOODS.includes(m as Mood));
  const advOk =
    typeof p.adventurousness === "number" &&
    p.adventurousness >= 0 &&
    p.adventurousness <= 100;
  return artistsOk && moodsOk && advOk;
}

export async function POST(request: Request) {
  // 1. Parse the body. A malformed/empty body makes request.json() throw,
  //    so guard it and return 400 rather than letting it 500.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  // 2. Validate inputs and narrow `body` to RefineRequest. The client owns
  //    discovery (calling /similar + /top-tracks), so we require both the seed
  //    `params` and the `candidates` pool it assembled.
  if (typeof body !== "object" || body === null) {
    return badRequest("Request body is required");
  }
  const { params, candidates, feedback } = body as Record<string, unknown>;
  if (!isSearchParams(params)) {
    return badRequest(
      "`params` must have 1–3 artists, valid moods, and adventurousness 0–100"
    );
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return badRequest("`candidates` must be a non-empty array");
  }
  if (!candidates.every(isRecommendedTrack)) {
    return badRequest("Each candidate must have a string `title` and `artist`");
  }
  if (feedback !== undefined && !isSwipeFeedback(feedback)) {
    return badRequest("`feedback` must have string arrays `liked` and `disliked`");
  }
  const refineRequest: RefineRequest = { params, candidates, feedback };

  // 3. Refine the client-supplied pool and return the curated songs.
  try {
    const result = await refineRecommendations(
      refineRequest.params,
      refineRequest.candidates,
      refineRequest.feedback
    );
    return NextResponse.json(result);
  } catch (err) {
    // RefineError carries a `.status` (mirrors LastfmError); map it before the 500.
    if (err instanceof RefineError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("refine route failed:", err);
    return NextResponse.json(
      { error: "Failed to refine recommendations" },
      { status: 500 }
    );
  }
}
