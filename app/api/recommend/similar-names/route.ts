import { NextResponse, type NextRequest } from "next/server";
import { getSimilarNames, LastfmError } from "@/lib/lastfm";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Match scores only, for building the taste-map similarity matrix. Unlike
 * `/api/recommend/similar` this skips the listener-count/tags enrichment,
 * because the caller already holds that data for these artists.
 */
export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  if (!artist) {
    return NextResponse.json(
      { error: "Query param 'artist' is required" },
      { status: 400 }
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const results = await getSimilarNames(artist, limit);
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof LastfmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to fetch similar artist names" },
      { status: 500 }
    );
  }
}
