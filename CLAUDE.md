# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Agent Rules
## Product vision

**Timbre is a song-recommendation app that turns a few favorite artists into a personalized, swipeable playlist.** The core loop is: *seed → discover → LLM refine → swipe → playlist → save*.

### The user journey

1. **Seed input** — The user enters **1–3 favorite artists**. Two optional controls shape the results:
   - **Mood** — a vibe/feeling to bias the selection toward.
   - **Adventurousness** — a numeric dial that controls how *obscure* the recommendations get (low = popular/safe, high = deep cuts and lesser-known artists).
2. **Discovery (Last.fm API)** — The seed artists + adventurousness level drive a search for **similar artists**, then pull **their top songs**. Adventurousness governs how far from the seed artists we reach.
3. **LLM refinement** — The raw candidate songs are handed to an **LLM**, which:
   - Refines/curates the final song selection to best match the seed, mood, and adventurousness.
   - Generates a **succinct description for each song** explaining *why it fits* what the user is looking for.
4. **Swipe UI (Tinder-style)** — Final recommended songs are presented one at a time. **Swipe right = like, swipe left = dislike.**
5. **Playlist construction** — The LLM uses the swipe feedback to **construct a finished playlist**, returned to the user once they've swiped through all songs.
6. **Playlist output** — Each song in the final playlist includes a **link to listen** (Spotify, YouTube, or Apple Music).
7. **Sign-up prompt** — After seeing the full playlist, the user is **prompted to create an account** in order to **save the playlists** they generate. (Discovery is usable pre-auth; saving requires auth.)

### Key roles of each piece

- **Last.fm API** = music discovery engine (similar artists + top tracks; obscurity tuned by adventurousness).
- **LLM** = curator + copywriter (refines selection, writes per-song "why it fits" blurbs, assembles the final playlist from swipes).
- **Auth + Supabase** = persistence layer (account creation gates saving playlists).

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build
npm run lint     # run ESLint
```

No test runner is configured yet.

## Current implementation state

The "Product vision" above is the **target**, not what's built. As of now the repo is a fresh `create-next-app` scaffold plus a single feature slice:

- **Built:** the auth backend — `signup` and `[...nextauth]` route handlers (see Auth flow below).
- **Default scaffold (not yet product UI):** `app/page.tsx` is still the Next.js starter template, and `app/layout.tsx` metadata still reads "Create Next App".
- **Not started:** the entire discovery loop (seed input UI, Last.fm integration, LLM refinement, swipe UI, playlist construction), the `/auth/signin` page, and playlist persistence.

When building the discovery loop, note two dependency gaps:
- `@supabase/supabase-js` is imported directly in the auth handlers but is only present **transitively** (via `@auth/supabase-adapter`). Add it to `package.json` dependencies before relying on it.
- `@anthropic-ai/sdk` is **not installed**, despite `ANTHROPIC_API_KEY` being documented. Install it before building the LLM step. Use the latest Claude models (see the `claude-api` skill for current model IDs).

## Architecture

**Timbre** is a Next.js 16 app with App Router, React 19, TypeScript, Tailwind CSS v4, NextAuth v4, and Supabase.

> Next.js 16 has breaking changes vs. earlier versions (see `AGENTS.md`). Consult `node_modules/next/dist/docs/` (`01-app`, `03-architecture`) before writing framework code rather than relying on prior Next.js knowledge.

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
| `LASTFM_API_KEY` | Last.fm API — powers the similar-artists/top-tracks discovery engine |
| `ANTHROPIC_API_KEY` | Claude API — powers the LLM curation/refinement step (the "LLM" in the product vision is Anthropic Claude) |

> The `.env` also carries `DB_PASSWORD`, `SHARED_SECRET`, and additional Supabase key variants; confirm their use before relying on them.

### Path aliases

`@/*` resolves to the repo root (configured in `tsconfig.json`).
