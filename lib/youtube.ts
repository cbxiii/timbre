/**
 * Build a YouTube search URL for a track. Deterministic and key-free — it lands
 * on a results page rather than a specific video, which is good enough for the
 * "listen" link in the swipe UI for now.
 */
export function youtubeSearchUrl(artist: string, title: string): string {
  return (
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(`${artist} ${title}`)
  );
}
