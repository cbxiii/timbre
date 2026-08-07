import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { MapArtist, TasteMapGraph, Verdict } from "@/lib/types";

/**
 * Layout for the taste map, in two independent stages:
 *
 *   angle  ← pairwise similarity, from an ordinary force-directed solve
 *   radius ← how well the artist fits the user's taste (`artistAffinity`),
 *            which blends seed similarity, swipe verdicts, and a popularity
 *            tilt read through the adventurousness dial
 *
 * Splitting them is what lets the map keep its promise that distance from the
 * center means fit. A single simulation carrying both would have to trade one
 * against the other — two artists very similar to each other but scoring
 * differently against the seed cannot satisfy both a link distance and their
 * target radii. So the force solve runs *unconstrained*, purely to discover
 * which artists belong near which, and only its angles are kept; radius is
 * applied afterward and is never negotiable.
 *
 * Deliberately pure: no React, no fetch, no DOM.
 */

/** The coordinate space the layout works in; matches TasteMap's SVG viewBox. */
export const MAP_SIZE = 1000;
const CENTER = MAP_SIZE / 2;

/**
 * Radius band for non-seed artists. Only the ratio to R_MAX reaches the screen:
 * `projectToRect` normalises by it, so R_MAX is the outer edge of the rendered
 * plot and R_MIN the innermost ring non-seed artists can reach.
 */
const R_MIN = 100;
const R_MAX = 370;

/** Radius of the small ring seeds are spaced around (0 when there's one seed). */
const SEED_RING = 34;

/** Ticks for the angle-finding solve. */
const TICKS = 400;
/** Repulsion in the angle solve — this is what spreads clusters apart. */
const CHARGE_STRENGTH = -220;
/** Link distance band: similar artists are pulled to the short end. */
const LINK_MIN_DISTANCE = 60;
const LINK_MAX_DISTANCE = 260;

/** Collision sizing — labels are text, so width scales with the artist name. */
const CHAR_W = 7.5;
const MIN_COLLIDE_R = 26;
const COLLIDE_PAD = 8;

/** Angular de-overlap passes run after radii are pinned. */
const ANGULAR_PASSES = 80;
const ANGULAR_RELAX = 0.5;

/** Ring the angle solve starts its nodes on. Only relative positions matter. */
const ANGLE_INIT_R = 200;

/**
 * How far popularity can shift an artist's prior affinity, at full adventurousness
 * tilt. Deliberately small: it is a nudge on a prior, not a competing axis.
 */
const POPULARITY_WEIGHT = 0.15;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface LaidOutNode extends MapArtist, SimulationNodeDatum {
  /** 0–1 fit to the user's taste. 1 for seeds. */
  affinity: number;
  /** Exact distance from center this node must end up at. */
  targetR: number;
  x: number;
  y: number;
}

/** A node placed in the rendered plot box, in px. */
export interface ProjectedNode extends LaidOutNode {
  px: number;
  py: number;
}

/**
 * Stable key for a song across the whole pipeline — candidate dedupe in
 * SwipeFlow and swipe verdicts here. One definition so the two can't drift.
 */
export function songKey(song: { artist: string; title: string }): string {
  return `${song.artist.trim().toLowerCase()}|${song.title.trim().toLowerCase()}`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Each artist's popularity as a percentile within the pool: 0 is the most
 * obscure artist on the map, 1 the most popular.
 *
 * Rank rather than the raw or log listener count, because listener counts are
 * power-law distributed. Under min/max normalisation one stadium act compresses
 * everyone else into the bottom few percent, and a log still leaves the tail
 * lumpy and scale-dependent. A rank is scale-free and needs no tuning constant.
 *
 * Artists with no usable count are simply absent from the map, which
 * `popularityBias` reads as neutral. That covers seeds (0 by construction, and
 * pinned at radius ~0 anyway) and the autocorrect fallbacks in
 * `buildTasteMapGraph`, which have no artist-level listener count to offer.
 */
export function popularityRanks(artists: MapArtist[]): Map<string, number> {
  const known = artists
    .filter((a) => !a.isSeed && a.listenerCount > 0)
    .sort((a, b) => a.listenerCount - b.listenerCount);

  const ranks = new Map<string, number>();
  known.forEach((artist, i) => {
    ranks.set(artist.artist, known.length === 1 ? 0.5 : i / (known.length - 1));
  });
  return ranks;
}

/**
 * How much an artist's popularity should move its prior affinity, within
 * ±POPULARITY_WEIGHT.
 *
 * Adventurousness picks the direction rather than the magnitude: at 0 the user
 * asked for the familiar, so popular artists earn a bonus and obscure ones a
 * penalty; at 100 that inverts. At 50 the tilt is exactly zero and popularity is
 * ignored, which is what keeps the neutral map identical to one with no
 * popularity signal at all.
 */
export function popularityBias(
  rank: number | undefined,
  adventurousness: number
): number {
  if (rank === undefined) return 0;
  const tilt = adventurousness / 50 - 1; // -1 familiar … +1 surprising
  const centered = rank * 2 - 1; // -1 obscure  … +1 popular
  return -tilt * centered * POPULARITY_WEIGHT;
}

/**
 * How well an artist fits the user's taste, in 0–1.
 *
 * Starts as the artist's Last.fm similarity to the seed — optionally nudged by
 * `bias`, the popularity tilt above — then swipe evidence progressively
 * overrides that prior as more of the artist's songs get judged: one verdict is
 * worth half the weight, three are worth three quarters. An artist whose songs
 * never came up keeps its prior unchanged.
 *
 * Popularity belongs in the prior rather than on top of the result because
 * `1 - weight` already means "how much we still trust the prior". Folding it in
 * there means a hunch about obscurity fades on exactly the same schedule as the
 * seed similarity it sits beside, with no second fading rule to keep in sync.
 */
export function artistAffinity(
  artist: MapArtist,
  verdicts: Map<string, Verdict>,
  bias = 0
): number {
  if (artist.isSeed) return 1;

  const prior = clamp01(artist.seedMatch + bias);

  let liked = 0;
  let judged = 0;
  for (const song of artist.songs) {
    const verdict = verdicts.get(songKey(song));
    if (!verdict) continue;
    judged++;
    if (verdict === "like") liked++;
  }

  if (judged === 0) return prior;

  const swipeScore = liked / judged;
  const weight = judged / (judged + 1);
  return clamp01((1 - weight) * prior + weight * swipeScore);
}

/**
 * Drop the artists the user swiped left on, along with every link that touched
 * them.
 *
 * A dislike is a verdict on the artist, not just the song: the deck deals one
 * card per artist, so a single left swipe is everything the user ever said about
 * them, and the map is meant to be artists they like. Seeds are never removed —
 * they are the frame of reference everything else is measured against.
 *
 * Links have to go with the nodes because TasteMap renders `graph.links`
 * directly; left alone they would draw lines to coordinates nothing occupies.
 * The graph is returned by identity when nothing was disliked, so the common
 * case costs a scan and no re-layout.
 *
 * Lives here rather than beside `buildTasteMapGraph` because it needs `songKey`,
 * and `lib/refine.ts` imports from that module on the server — the import would
 * pull `d3-force` into the server bundle along with it.
 */
export function pruneDislikedArtists(
  graph: TasteMapGraph,
  verdicts: Map<string, Verdict>
): TasteMapGraph {
  const removed = new Set<string>();
  for (const artist of graph.artists) {
    if (artist.isSeed) continue;
    const disliked = artist.songs.some(
      (song) => verdicts.get(songKey(song)) === "dislike"
    );
    if (disliked) removed.add(artist.artist);
  }

  if (removed.size === 0) return graph;

  return {
    artists: graph.artists.filter((a) => !removed.has(a.artist)),
    links: graph.links.filter(
      (l) => !removed.has(l.source) && !removed.has(l.target)
    ),
  };
}

function collideRadius(node: LaidOutNode): number {
  return (
    Math.max(MIN_COLLIDE_R, (node.artist.length * CHAR_W) / 2) + COLLIDE_PAD
  );
}

/** Signed shortest angular distance from `a` to `b`, in radians. */
function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Fixed-seed PRNG handed to the simulation.
 *
 * d3's forceCollide and forceManyBody call the simulation's random source (via
 * their internal `jiggle`) to separate coincident nodes. Left alone that would
 * be Math.random, so identical input would produce a different map every run.
 */
function deterministicRandom(): () => number {
  let s = 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AngleNode extends SimulationNodeDatum {
  artist: string;
}

/**
 * Find each artist's angle with an ordinary force-directed graph layout.
 *
 * Radius is deliberately not modelled here — the solve is free to put clusters
 * wherever they naturally fall, and only the *direction* of each node from the
 * layout's center is kept. Charge repulsion is what spreads clusters around the
 * circle instead of letting them collapse into one quadrant.
 *
 * Seeds take part (they're legitimate hubs that hold clusters together) but
 * their own angles are discarded: they end up near the centroid, where a
 * direction is meaningless, and they get placed analytically instead.
 */
function solveAngles(graph: TasteMapGraph): Map<string, number> {
  const nodes: AngleNode[] = graph.artists.map((artist, i) => {
    const angle = i * GOLDEN_ANGLE;
    return {
      artist: artist.artist,
      x: ANGLE_INIT_R * Math.cos(angle),
      y: ANGLE_INIT_R * Math.sin(angle),
    };
  });

  const byName = new Map(nodes.map((n) => [n.artist, n]));
  const links = graph.links
    .filter((l) => byName.has(l.source) && byName.has(l.target))
    .map((l) => ({
      source: byName.get(l.source)!,
      target: byName.get(l.target)!,
      sim: l.sim,
    }));

  const simulation = forceSimulation<AngleNode>(nodes)
    .randomSource(deterministicRandom())
    .force(
      "link",
      forceLink<AngleNode, (typeof links)[number]>(links)
        .distance(
          (l) => LINK_MIN_DISTANCE + (LINK_MAX_DISTANCE - LINK_MIN_DISTANCE) * (1 - l.sim)
        )
        .strength((l) => 0.1 + l.sim * 0.6)
    )
    .force("charge", forceManyBody<AngleNode>().strength(CHARGE_STRENGTH))
    .force("center", forceCenter<AngleNode>(0, 0))
    .stop();

  for (let i = 0; i < TICKS; i++) simulation.tick();

  const angles = new Map<string, number>();
  nodes.forEach((node, i) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    // A node sitting exactly on the centroid has no meaningful direction.
    angles.set(
      node.artist,
      Math.hypot(x, y) < 1e-6 ? i * GOLDEN_ANGLE : Math.atan2(y, x)
    );
  });
  return angles;
}

/**
 * Place every non-seed node at exactly its target radius on the angle the solve
 * found, after relaxing label overlaps *in angle only*.
 *
 * Pinning radius exactly is what makes "third ring out" literally true, and so
 * what lets the map label its guide rings honestly. Overlaps are then resolved
 * by sliding nodes around their own ring, which never disturbs that.
 */
function placeOnRings(nodes: LaidOutNode[], solvedAngles: Map<string, number>): void {
  const solved = nodes.filter((n) => !n.isSeed);
  const angles = solved.map((n, i) => solvedAngles.get(n.artist) ?? i * GOLDEN_ANGLE);
  const radii = solved.map(collideRadius);

  for (let pass = 0; pass < ANGULAR_PASSES; pass++) {
    for (let i = 0; i < solved.length; i++) {
      for (let j = i + 1; j < solved.length; j++) {
        const ri = solved[i].targetR;
        const rj = solved[j].targetR;
        const clearance = radii[i] + radii[j];
        // Different enough rings that the labels can't collide anyway.
        if (Math.abs(ri - rj) > clearance) continue;

        // Arc length needed for clearance, expressed as an angle on the
        // outer of the two rings.
        const minGap = clearance / Math.max(ri, rj, 1);
        const d = angleDiff(angles[i], angles[j]);
        const gap = Math.abs(d);
        if (gap >= minGap) continue;

        const push = ((minGap - gap) / 2) * ANGULAR_RELAX;
        const dir = d === 0 ? 1 : Math.sign(d);
        angles[i] -= dir * push;
        angles[j] += dir * push;
      }
    }
  }

  solved.forEach((node, i) => {
    node.x = CENTER + node.targetR * Math.cos(angles[i]);
    node.y = CENTER + node.targetR * Math.sin(angles[i]);
  });
}

/**
 * Lay the graph out in the fixed MAP_SIZE coordinate space.
 *
 * Deterministic: the same graph, verdicts and adventurousness always yield the
 * same coordinates. Seeds are placed analytically and pinned, which both anchors
 * the layout and keeps the solve stable.
 *
 * `adventurousness` reaches only the radius, via the popularity tilt. Angles come
 * from pairwise similarity alone, so turning the dial slides artists in and out
 * along fixed bearings rather than rearranging the map.
 */
export function layoutTasteMap(
  graph: TasteMapGraph,
  verdicts: Map<string, Verdict>,
  adventurousness = 50
): LaidOutNode[] {
  const seeds = graph.artists.filter((a) => a.isSeed);
  const seedRing = seeds.length > 1 ? SEED_RING : 0;
  let seedIndex = 0;

  // Ranked once over the whole pool: a percentile is only meaningful relative to
  // the other artists on this particular map.
  const ranks = popularityRanks(graph.artists);

  const nodes: LaidOutNode[] = graph.artists.map((artist) => {
    const affinity = artistAffinity(
      artist,
      verdicts,
      popularityBias(ranks.get(artist.artist), adventurousness)
    );
    const targetR = artist.isSeed
      ? seedRing
      : R_MIN + (R_MAX - R_MIN) * (1 - affinity);

    // Seeds are placed analytically: evenly spaced on a small ring, or dead
    // center when there's only one. Solved nodes are positioned by placeOnRings.
    const seedAngle =
      (seedIndex / Math.max(seeds.length, 1)) * 2 * Math.PI - Math.PI / 2;
    if (artist.isSeed) seedIndex++;

    return {
      ...artist,
      affinity,
      targetR,
      x: artist.isSeed ? CENTER + seedRing * Math.cos(seedAngle) : CENTER,
      y: artist.isSeed ? CENTER + seedRing * Math.sin(seedAngle) : CENTER,
    };
  });

  placeOnRings(nodes, solveAngles(graph));
  return nodes;
}

/**
 * Guide-ring radii for the map background, outermost first.
 *
 * Left unlabelled on purpose: any in-map label sits on a ring, which is exactly
 * where artists sit too, so the two collide. The map explains its radius axis
 * with a legend outside the plot instead.
 */
export const GUIDE_RINGS: number[] = [
  R_MAX,
  R_MIN + (R_MAX - R_MIN) * 0.66,
  R_MIN + (R_MAX - R_MIN) * 0.33,
  R_MIN,
];

/** The same contours as fractions of the way to the plot's edge, for `projectToRect`. */
export const GUIDE_RING_FRACTIONS: number[] = GUIDE_RINGS.map((r) => r / R_MAX);

/** Guards the division when a node sits on one of the axes. */
const EPS = 1e-6;

/**
 * Map the square layout onto the rendered rectangle.
 *
 * The solve above works in a square because that is where the angle/radius
 * separation is expressible; a screen is not square, and an inscribed circle
 * would waste most of a laptop's width and most of a phone's height. So each
 * node keeps its solved angle and its radius *as a fraction of R_MAX*, and is
 * placed that fraction of the way to the rectangle's boundary along that angle.
 * Artists on the outermost ring land on the edge — corners included — while
 * "fraction of the way out" still means exactly what it meant before.
 *
 * Nothing is stretched: the projection moves points, so dots stay circular and
 * links stay straight. And since the boundary distance is never shorter than
 * half the rectangle's short side — the scale an inscribed square would have
 * used — the angular clearance `placeOnRings` won can only improve here.
 *
 * Pure and cheap: this is what reruns on resize, never the force solve.
 */
export function projectToRect(
  nodes: LaidOutNode[],
  width: number,
  height: number
): ProjectedNode[] {
  const halfW = width / 2;
  const halfH = height / 2;

  return nodes.map((node) => {
    const angle = Math.atan2(node.y - CENTER, node.x - CENTER);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const t = node.targetR / R_MAX;

    const edge = Math.min(
      halfW / Math.max(Math.abs(cos), EPS),
      halfH / Math.max(Math.abs(sin), EPS)
    );

    return {
      ...node,
      px: halfW + t * edge * cos,
      py: halfH + t * edge * sin,
    };
  });
}

export { CENTER as MAP_CENTER, R_MAX as MAP_MAX_RADIUS };
