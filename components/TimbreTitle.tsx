import Link from "next/link";

/** App wordmark; links back to the home/seed page. Shared by the seed form
 * and the swipe-flow header so the title persists across the whole journey. */
export default function TimbreTitle() {
  return (
    <Link
      href="/"
      className="block text-center text-4xl font-bold tracking-[0.3em] text-neon"
    >
      TIMBRE
    </Link>
  );
}
