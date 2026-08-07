"use client";

import { useEffect, useState } from "react";
import type { ArtistSuggestion } from "@/lib/types";

/**
 * Last.fm's artist.search is fuzzy whole-string matching, not prefix matching,
 * so anything shorter than this returns noise rather than partial matches.
 */
const MIN_QUERY_LENGTH = 3;
/** Wait this long after the last keystroke before hitting the API. */
const DEBOUNCE_MS = 250;
const LIMIT = 8;

const EMPTY: ArtistSuggestion[] = [];

/**
 * Artist-name suggestions for `query`, debounced and race-free.
 *
 * The effect's cleanup both clears the pending timer and aborts the in-flight
 * request, so a slow response for an older prefix can never land after a newer
 * one — the same AbortController-in-cleanup idiom as SwipeFlow's pipeline.
 *
 * Results are stored tagged with the query that produced them, which lets both
 * `loading` and the short-query reset be derived during render instead of
 * written back from the effect. It also means the previous prefix's results
 * stay on screen while the next request is in flight, so the dropdown doesn't
 * blank out between keystrokes.
 */
export function useArtistSearch(query: string): {
  suggestions: ArtistSuggestion[];
  loading: boolean;
} {
  const [result, setResult] = useState<{
    query: string;
    suggestions: ArtistSuggestion[];
  }>({ query: "", suggestions: EMPTY });

  const trimmed = query.trim();
  const enabled = trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/artists/search?q=${encodeURIComponent(trimmed)}&limit=${LIMIT}`,
        { signal: controller.signal },
      )
        .then((res) => (res.ok ? (res.json() as Promise<ArtistSuggestion[]>) : EMPTY))
        .then((suggestions) => setResult({ query: trimmed, suggestions }))
        .catch(() => {
          // A typeahead that shouts on every network blip is worse than one
          // that quietly shows nothing. Aborts land here too and are ignored.
          if (controller.signal.aborted) return;
          setResult({ query: trimmed, suggestions: EMPTY });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, enabled]);

  return {
    suggestions: enabled ? result.suggestions : EMPTY,
    loading: enabled && result.query !== trimmed,
  };
}
