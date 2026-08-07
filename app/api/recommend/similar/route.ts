import { NextResponse, type NextRequest } from "next/server";
import { getSimilarArtists, LastfmError } from "@/lib/lastfm";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * How far down the similar-artist list to start. Later discovery rounds walk
 * this forward to reach artists earlier rounds never surfaced.
 *
 * Clamped against `limit` rather than on its own, because `skip + limit` is what
 * Last.fm is actually asked for — an unclamped skip would silently blow past
 * MAX_LIMIT and return an empty window.
 */
function parseSkip(raw: string | null, limit: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < 1) return 0;
  return Math.min(n, MAX_LIMIT - limit);
}

export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  if (!artist) {
    return NextResponse.json(
      { error: "Query param 'artist' is required" },
      { status: 400 }
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const skip = parseSkip(request.nextUrl.searchParams.get("skip"), limit);

  try {
    const results = await getSimilarArtists(artist, limit, skip);
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof LastfmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to fetch similar artists" },
      { status: 500 }
    );
  }
}
