"use client";

import { useState, type KeyboardEvent, type RefObject } from "react";

type ArtistTagInputProps = {
  artists: string[];
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
};

const MAX_ARTISTS = 3;

export default function ArtistTagInput({
  artists,
  onAdd,
  onRemove,
  error,
  inputRef,
}: ArtistTagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const atMax = artists.length >= MAX_ARTISTS;

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onAdd(inputValue);
      setInputValue("");
    } else if (e.key === "Backspace" && inputValue === "" && artists.length > 0) {
      onRemove(artists.length - 1);
    }
  }

  const placeholder = atMax
    ? "Max 3 artists"
    : artists.length === 0
      ? "Type an artist, press Enter"
      : "Add another…";

  return (
    <div>
      <label htmlFor="artist-input" className="mb-2 block text-sm text-muted">
        Your favorite artists
      </label>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neon/30 bg-bg-elevated px-3 py-2 focus-within:border-neon">
        {artists.map((artist, i) => (
          <span
            key={`${artist}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-neon/10 px-3 py-1 text-sm text-neon"
          >
            {artist}
            <button
              type="button"
              aria-label={`Remove ${artist}`}
              onClick={() => onRemove(i)}
              className="text-neon/70 hover:text-neon"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="artist-input"
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={atMax}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? "artist-error" : undefined}
          className="flex-1 bg-transparent text-neon placeholder:text-muted outline-none disabled:cursor-not-allowed"
        />
      </div>
      {error && (
        <p id="artist-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
