import Link from "next/link";
import SwipeFlow from "@/components/SwipeFlow";
import { MOODS, type Mood, type SearchParams } from "@/lib/types";

/** Normalize a query value (string | string[] | undefined) to a string array. */
function toArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

export default async function SwipePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;

  const artists = toArray(sp.artist)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 3);
  const moods = toArray(sp.mood).filter((m): m is Mood =>
    MOODS.includes(m as Mood),
  );
  const advRaw = Number.parseInt(Array.isArray(sp.adv) ? sp.adv[0] : sp.adv ?? "", 10);
  const adventurousness = Number.isNaN(advRaw)
    ? 50
    : Math.min(Math.max(advRaw, 0), 100);

  if (artists.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-lg text-muted">
          No artists to discover from. Start by picking a few.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-xl bg-neon px-6 py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
        >
          Start over
        </Link>
      </div>
    );
  }

  const params: SearchParams = { artists, moods, adventurousness };
  // Key by seed so submitting a new seed remounts SwipeFlow with fresh state.
  const seedKey = `${artists.join(",")}|${moods.join(",")}|${adventurousness}`;
  return <SwipeFlow key={seedKey} params={params} />;
}
