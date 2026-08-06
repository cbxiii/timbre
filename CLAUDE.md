# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Agent Rules
## Product vision

**Timbre is a song-recommendation app that turns a few favorite artists into a personalized taste map.** The core loop is: *seed → discover → LLM refine → swipe → taste map → save*.

### The user journey

1. **Seed input** — The user enters **1–3 favorite artists**. Two optional controls shape the results:
   - **Mood** — a vibe/feeling to bias the selection toward.
   - **Adventurousness** — a numeric dial that controls how *obscure* the recommendations get (low = popular/safe, high = deep cuts and lesser-known artists).
2. **Discovery (Last.fm API)** — The seed artists + adventurousness level drive a search for **similar artists**, then pull **their top songs**. Adventurousness governs how far from the seed artists we reach.
3. **LLM refinement** — The raw candidate songs are handed to an **LLM**, which:
   - Refines/curates the final song selection to best match the seed, mood, and adventurousness.
   - Generates a **succinct description for each song** explaining *why it fits* what the user is looking for.
4. **Swipe UI (Tinder-style)** — Final recommended songs are presented one at a time. **Swipe right = like, swipe left = dislike.**
5. **Taste map** — Once every card is swiped, the result is a **spatial map of artists** in the style of music-map.com, not a playlist. **Distance from the center encodes fit to the user's taste**: seed artists sit at the center, and every other artist's radius comes from its Last.fm similarity to the seed blended with the swipe verdicts on its songs. Artists similar *to each other* are placed near each other angularly.
6. **Expand to songs** — Clicking any artist on the map reveals the curated songs for that artist, each with the LLM's "why it fits" blurb, its swipe verdict, and a **link to listen**.
7. **Sign-up prompt** — The user is **prompted to create an account** in order to **save the maps** they generate. (Discovery is usable pre-auth; saving requires auth.) *Not yet built.*

### Key roles of each piece

- **Last.fm API** = music discovery engine (similar artists + top tracks) *and* the source of the map's geometry (match scores, listener counts, tags).
- **LLM** = curator + copywriter (refines the song selection, writes per-song "why it fits" blurbs). It does **not** build the map — that's deterministic math in `lib/`.
- **Auth + Supabase** = persistence layer (account creation gates saving). Currently auth-only; nothing persists maps yet.

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build
npm run lint     # run ESLint
```

No test runner is configured yet.

## Current implementation state

The whole main loop — seed input → discovery → LLM refinement → swipe → taste map — is **built and working end to end**.

- **Built:** the auth backend (`signup` and `[...nextauth]` route handlers); the seed-input screen; the Last.fm discovery routes; the LLM refine step; the swipe deck; the taste map.
- **Not started:** the `/auth/signin` page (NextAuth's `pages.signIn` points at it, so a redirect there currently 404s), saving maps to Supabase, and the sign-up prompt after the map.

Known gaps worth knowing before extending:
- `@supabase/supabase-js` is imported directly in the auth handlers but is only present **transitively** (via `@auth/supabase-adapter`). Add it to `package.json` dependencies before relying on it.
- **`adventurousness` doesn't affect discovery.** It reaches the LLM prompt but never biases candidate obscurity — `SimilarArtist.listenerCount` is captured on `MapArtist` for exactly this purpose and currently goes unused by the layout.
- **`moods` are only prompt text**, never used as Last.fm tag filters.
- Discovery fans out from the **browser**: ~16 round-trips through our own routes, each fanning out N+1 to Last.fm (~96 upstream calls per session). A server-side orchestrating route would collapse this and allow per-seed caching.
- No test runner is configured. `lib/similarity.ts`, `lib/tasteMapGraph.ts`, and `lib/tasteMapLayout.ts` are deliberately pure (no React, fetch, or DOM) and are the natural first unit tests.

## Architecture

**Timbre** is a Next.js 16 app with App Router, React 19, TypeScript, Tailwind CSS v4, NextAuth v4, and Supabase.

> Next.js 16 has breaking changes vs. earlier versions (see `AGENTS.md`). Consult `node_modules/next/dist/docs/` (`01-app`, `03-architecture`) before writing framework code rather than relying on prior Next.js knowledge.

### Discovery + taste map flow

Client-orchestrated: the route handlers are thin Last.fm/LLM proxies, and `components/SwipeFlow.tsx` drives the pipeline from the browser.

- `app/swipe/page.tsx` — server component; parses seed `searchParams` (`artist` ×1–3, `mood` ×N, `adv` 0–100) and renders `SwipeFlow` keyed by seed so a new seed remounts.
- `components/SwipeFlow.tsx` — the orchestrator. Fetches similar artists → top tracks → the similarity matrix → LLM refine, then assembles the graph. **Owns the swipe verdicts** (`Map<songKey, Verdict>`) because the map is built from them.
- `components/SwipeDeck.tsx` — swipe mechanics only (hand-rolled pointer events, no animation library). Reports verdicts upward; renders no result screen of its own.
- `components/TasteMap.tsx` — the map. `fixed inset-0`, painting over the `/swipe` TIMBRE header so it owns the whole viewport; the heading, taste axis and "Start over" float over it as click-through overlays, and the plot rect is inset to clear those bands. Two aligned layers: an SVG for contours/links/dots, and absolutely-positioned HTML `<button>`s for artist labels (real focus rings, `aria-expanded`, keyboard access). A `ResizeObserver` on the plot rect feeds `projectToRect`, and both layers render from those same measured pixel positions — that shared pixel space, not percentages, is what keeps them locked. Until the observer first fires the plot is empty, which is also what the server renders, so hydration has nothing to disagree about and no `ssr: false` import is needed. Guide contours are the plot rect scaled down rather than circles, because the envelope is rectangular.
- `components/ArtistSongsDialog.tsx` — clicking an artist opens this: a native `<dialog>` driven by `showModal()`, which supplies focus trapping, Escape-to-close, focus restoration to the label, and top-layer stacking above the fixed map. Lists the artist's curated songs with the LLM blurb, the swipe verdict glyph, and a listen link.

The math lives in pure modules, all free of React/fetch/DOM:

- `lib/similarity.ts` — the pairwise similarity matrix. Blends Last.fm `match` (high quality, **sparse**) with **IDF-weighted** tag Jaccard (dense, noisy): `0.7·match + 0.3·tag` where a match exists, `0.5·tag` otherwise. IDF matters — raw Jaccard would treat "indie" (on nearly every artist) like "shoegaze" (on two). Then sparsified to the union of each node's top `MAX_DEGREE` links, since a near fully-connected graph collapses into a blob.
- `lib/tasteMapGraph.ts` — folds seeds, discovered artists, curated songs and matrix responses into a `TasteMapGraph`.
- `lib/tasteMapLayout.ts` — **angle and radius are solved independently, and that separation is the point.** An ordinary force-directed solve (`forceLink` + `forceManyBody` + `forceCenter`, *no* radial force) runs unconstrained purely to discover which artists belong near which; only its **angles** are kept. Radius then comes from `artistAffinity` and is applied afterward, so nothing can ever negotiate it away. Overlaps are relaxed by sliding nodes around their own ring. Layout is **deterministic** — a fixed-seed PRNG is passed via `randomSource` because d3's `forceManyBody`/`forceLink` call it internally via `jiggle`. `projectToRect` then maps that square solve onto the actual viewport rectangle: each node keeps its angle and its radius *as a fraction of `R_MAX`*, and is placed that fraction of the way to the rectangle's edge along that angle — so artists reach the edges and corners on a wide laptop and a tall phone alike, without stretching the space (dots stay circular). It is separate from `layoutTasteMap` on purpose: the projection is what reruns on resize, never the 400-tick solve.

`artistAffinity` starts at the artist's Last.fm similarity to the seed, then swipe evidence progressively overrides it as more of that artist's songs get judged (weight `judged/(judged+1)`). An artist whose songs never came up keeps its similarity score unchanged.

### Auth flow

- `app/api/auth/[...nextauth]/route.ts` — NextAuth Credentials Provider; queries the `profiles` table in Supabase (columns: `id`, `email`, `password_hash`), verifies passwords with bcryptjs (12 rounds), uses JWT session strategy
- `app/api/auth/signup/route.ts` — POST endpoint for user registration
- `types/next-auth.d.ts` — extends `Session` with `user.id` and `user.email`
- Sign-in page is expected at `/auth/signin` (not yet built)

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | Canonical app URL for NextAuth callbacks |
| `LASTFM_API_KEY` | Last.fm API — powers discovery and the taste map's geometry |
| `LLM_API_KEY` | API key for the LLM gateway used by the refine step |
| `LLM_API_URL` | Base URL of that gateway (passed as `baseURL` to the OpenAI SDK) |

> **The LLM is not Anthropic Claude.** `lib/ai.ts` uses the `openai` npm SDK pointed at a custom gateway (`LLM_API_URL`), with model `chatgpt-gpt-5.5`. `ANTHROPIC_API_KEY` is **not** used and `@anthropic-ai/sdk` is not installed. Earlier revisions of this file claimed otherwise.

> The `.env` also carries `DB_PASSWORD`, `SHARED_SECRET`, and additional Supabase key variants; confirm their use before relying on them.

### Path aliases

`@/*` resolves to the repo root (configured in `tsconfig.json`).
