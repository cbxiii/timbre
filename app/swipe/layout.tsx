import TimbreTitle from "@/components/TimbreTitle";

/** Segment layout for /swipe: pins the TIMBRE title at the top across every
 * swipe state (loading, deck, "All done", error, no-artists). Children flex to
 * fill the space below the header. */
export default function SwipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="pt-8 pb-4">
        <TimbreTitle />
      </header>
      {children}
    </div>
  );
}
