import { NextResponse, type NextRequest } from "next/server";
import { searchArtists, LastfmError } from "@/lib/lastfm";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  // `q`, not `artist`: this is a partial/fuzzy query, not an exact artist name
  // like the /api/recommend routes take.
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { error: "Query param 'q' is required" },
      { status: 400 }
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const results = await searchArtists(q, limit);
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof LastfmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to search artists" },
      { status: 500 }
    );
  }
}
