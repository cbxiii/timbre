"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useArtistSearch } from "@/lib/useArtistSearch";

type ArtistTagInputProps = {
  artists: string[];
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
};

const MAX_ARTISTS = 3;

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const LISTBOX_ID = "artist-listbox";
const optionId = (i: number) => `artist-option-${i}`;

export default function ArtistTagInput({
  artists,
  onAdd,
  onRemove,
  error,
  inputRef,
}: ArtistTagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const atMax = artists.length >= MAX_ARTISTS;

  const { suggestions } = useArtistSearch(inputValue);

  // Never offer something already tagged — addArtist would silently drop it.
  const filtered = suggestions.filter(
    (s) => !artists.some((a) => a.toLowerCase() === s.name.toLowerCase()),
  );
  const showDropdown = isOpen && !atMax && filtered.length > 0;

  // Keep the highlighted row visible when arrowing past the scroll edge.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    listRef.current?.children[highlightedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedIndex]);

  function commit(name: string) {
    onAdd(name);
    setInputValue("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const { key } = e;

    if (key === "ArrowDown" || key === "ArrowUp") {
      if (filtered.length === 0) return;
      e.preventDefault(); // don't jump the caret to the ends of the text
      setIsOpen(true);
      setHighlightedIndex((prev) => {
        if (prev === -1) return key === "ArrowDown" ? 0 : filtered.length - 1;
        const delta = key === "ArrowDown" ? 1 : -1;
        return (prev + delta + filtered.length) % filtered.length;
      });
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      // Nothing highlighted (or the list shrank underneath us) falls back to
      // the raw text, so an artist Last.fm can't find is still a valid seed.
      const picked = showDropdown ? filtered[highlightedIndex] : undefined;
      commit(picked ? picked.name : inputValue);
      return;
    }

    if (key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    if (key === "Tab") {
      setIsOpen(false);
      return;
    }

    if (key === "Backspace" && inputValue === "" && artists.length > 0) {
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

      <div className="relative">
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
            onChange={(e) => {
              setInputValue(e.target.value);
              // A highlight from the previous prefix must not survive into the
              // new result set.
              setHighlightedIndex(-1);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setIsOpen(false)}
            disabled={atMax}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
            }
            aria-invalid={!!error}
            aria-describedby={error ? "artist-error" : undefined}
            className="flex-1 bg-transparent text-neon placeholder:text-muted outline-none disabled:cursor-not-allowed"
          />
        </div>

        {showDropdown && (
          <ul
            id={LISTBOX_ID}
            ref={listRef}
            role="listbox"
            className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-neon/30 bg-bg-elevated py-1"
          >
            {filtered.map((suggestion, i) => (
              <li
                key={suggestion.name}
                id={optionId(i)}
                role="option"
                aria-selected={i === highlightedIndex}
                aria-label={`${suggestion.name}, ${suggestion.listenerCount.toLocaleString("en")} listeners`}
                // Keep focus in the input so onBlur can't close the list before
                // the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(suggestion.name)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                  i === highlightedIndex ? "bg-neon/10 text-neon" : "text-muted"
                }`}
              >
                <span className="truncate">{suggestion.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {compactNumber.format(suggestion.listenerCount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p id="artist-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
