"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { Mood } from "@/lib/types";
import ArtistTagInput from "./ArtistTagInput";
import CustomizeSection from "./CustomizeSection";
import TimbreTitle from "./TimbreTitle";

const MAX_ARTISTS = 3;

export default function TimbreForm() {
  const [artists, setArtists] = useState<string[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [adventurousness, setAdventurousness] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function addArtist(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (artists.length >= MAX_ARTISTS) return;
    if (artists.some((a) => a.toLowerCase() === name.toLowerCase())) return;
    setArtists((prev) => [...prev, name]);
    setError(null);
  }

  function removeArtist(index: number) {
    setArtists((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleMood(mood: Mood) {
    setMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood],
    );
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (artists.length === 0) {
      setError("Add at least one artist to get started.");
      inputRef.current?.focus();
      return;
    }
    setError(null);

    // Hand the seed off to /swipe via query params: one `artist`/`mood` entry
    // each, plus `adv`. The swipe page reads these and runs the discovery flow.
    const qs = new URLSearchParams();
    artists.forEach((a) => qs.append("artist", a));
    moods.forEach((m) => qs.append("mood", m));
    qs.set("adv", String(adventurousness));
    router.push(`/swipe?${qs.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-12"
    >
      <TimbreTitle />

      <ArtistTagInput
        artists={artists}
        onAdd={addArtist}
        onRemove={removeArtist}
        error={error}
        inputRef={inputRef}
      />

      <CustomizeSection
        moods={moods}
        onToggleMood={toggleMood}
        adventurousness={adventurousness}
        onAdventurousnessChange={setAdventurousness}
      />

      <button
        type="submit"
        className="w-full rounded-xl bg-neon py-3 font-semibold text-bg transition-colors hover:bg-neon-dim"
      >
        Find my songs
      </button>
    </form>
  );
}
