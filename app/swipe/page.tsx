import SwipeDeck from "@/components/SwipeDeck";
import type { Song } from "@/components/SongCard";

// Placeholder recommendations until the Last.fm + LLM discovery pipeline is
// wired up. The `description` field stands in for the LLM's "why it fits" blurb.
const DUMMY_SONGS: Song[] = [
  {
    title: "Midnight City",
    artist: "M83",
    description:
      "Soaring synths and that iconic sax outro — a euphoric night-drive anthem that matches your high-energy seeds.",
  },
  {
    title: "Holocene",
    artist: "Bon Iver",
    description:
      "Hushed, layered, and introspective. Picked for the melancholic, slow-burn corner of your taste.",
  },
  {
    title: "The Less I Know the Better",
    artist: "Tame Impala",
    description:
      "A bouncy bassline wrapped in psychedelic haze — a danceable deep cut for the more adventurous side.",
  },
  {
    title: "Redbone",
    artist: "Childish Gambino",
    description:
      "Falsetto-driven funk with a warm, vintage groove. A smooth pick that bridges your chill and soulful leanings.",
  },
  {
    title: "Motion Sickness",
    artist: "Phoebe Bridgers",
    description:
      "Sharp, confessional indie with a driving beat — emotional weight that still moves.",
  },
];

export default function SwipePage() {
  return <SwipeDeck songs={DUMMY_SONGS} />;
}
