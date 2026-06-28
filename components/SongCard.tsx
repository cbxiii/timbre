import type { CSSProperties } from "react";

export type Song = {
  title: string;
  artist: string;
  description: string;
};

// Distance (px) a card must be dragged before a swipe commits. Shared with
// SwipeDeck so the outline reaches full color exactly at the commit point.
export const SWIPE_THRESHOLD = 120;

// rgb channels for the theme tokens in globals.css (--neon / --danger), used
// to build the rgba() border color since Tailwind can't interpolate opacity
// from a drag value at runtime.
const NEON_RGB = "57, 255, 20"; // #39ff14
const DANGER_RGB = "255, 92, 92"; // #ff5c5c

type SongCardProps = {
  song: Song;
  dragX: number;
  style?: CSSProperties;
};

export default function SongCard({ song, dragX, style }: SongCardProps) {
  // Outline grows toward full color as the card is dragged: green to the
  // right (like), red to the left (dislike).
  const intensity = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);
  const rgb = dragX >= 0 ? NEON_RGB : DANGER_RGB;
  const borderColor = `rgba(${rgb}, ${intensity})`;

  return (
    <div
      className="flex h-96 w-80 flex-col rounded-2xl border-2 bg-bg-elevated p-6 shadow-xl select-none"
      style={{
        borderColor,
        transform: `translateX(${dragX}px) rotate(${dragX * 0.04}deg)`,
        ...style,
      }}
    >
      <h2 className="text-2xl font-bold text-neon">{song.title}</h2>
      <p className="mt-1 text-sm tracking-wide text-muted">{song.artist}</p>

      <p className="mt-auto text-sm leading-relaxed text-muted">
        {song.description}
      </p>
    </div>
  );
}
