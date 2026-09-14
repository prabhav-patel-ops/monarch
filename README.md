# MONARCH

A progression system for training, problem solving and study. Installable to your
home screen; works offline.

## What it is

Five stats, fed by what you actually do:

| Stat | Fed by |
|------|--------|
| STR | Gym and calisthenics |
| AGI | Codeforces |
| INT | Maths and finance |
| PER | Brainteasers |
| VIT | Sleep, food, recovery |

Six screens: **Status** (level, rank, stat radar, streak), **Quests** (today's
generated quest board), **Gates** (contests, deadlines, rating thresholds),
**Body** (the APEX fitness module — training, macros, water, weight, waist,
sleep), **Shadows** (shipped projects, each granting a permanent XP multiplier),
and **System** (chat).

## The quest engine

Each day is generated from three inputs:

1. **The baseline template** for that weekday, editable in the app.
2. **Your current progression** — the Codeforces band, page target and
   brainteaser count all ratchet upward after 8 consecutive clean days in a
   stat, and step back down after two misses inside a rolling seven days.
3. **Yesterday** — anything missed returns today as a penalty quest worth half
   the lost XP.

Rest, recovery and idle quests are never penalised. Resting is a move, not a gap.

Every rule is a readable constant in `src/engine.js`. There is no model and no
black box; you can retune the pacing yourself.

## Running it

```bash
npm install
npm run dev      # local
npm test         # 57 assertions plus a one-year pacing simulation
npm run build    # produces dist/
```

## Deploying

The production app is deployed by GitHub Actions to:

**https://prabhav-patel-ops.github.io/monarch/**

Every push to `main` runs the complete test suite, builds with the repository
base path, checks the generated PWA paths, and publishes `dist/` to GitHub
Pages. The deployment does not require a local Vite server or repository
secrets.

The core app, local save, recovery snapshots, and backup import/export all work
on the static deployment. The optional System chat and meal-photo scan still
require the Netlify function and `ANTHROPIC_API_KEY`; no browser-side secret is
added for Pages.

## Turning on the System chat

Everything except the System tab works with no account and no network. The chat
needs an Anthropic API key, held server-side so it never reaches the browser.

1. Get a key at console.anthropic.com and add a little credit.
2. Deploy this repo to Netlify (connect the folder, or Netlify Drop plus a
   manual function upload — connecting the repo is easier because
   `netlify/functions` deploys itself).
3. Site configuration → Environment variables → add `ANTHROPIC_API_KEY`.
4. Redeploy.

If the key is missing the System tab explains exactly what to do rather than
failing silently. No other screen is affected.

## Scanning meals

The Body screen can estimate a meal from a photo. It needs the same
`ANTHROPIC_API_KEY` as the System chat; without it the manual food search still
works normally.

How it handles the accuracy problem: a photo identifies food reliably and judges
portion size badly, and portion size is what determines calories. So anything
recognised from the built-in food list is re-costed from that list's reference
macros, and only the portion stays an estimate. Items outside the list are
flagged, because both their portion and their macros are guesses.

Nothing is written straight to the log. You get a draft with per-item half /
−20% / +25% / double controls, and each row is labelled confident, rough or
guess. Correct the amounts, then log.

Treat the output as a starting point. Expect to be within about 20% on a plain
plate and further out on mixed dishes, anything in a deep bowl, or anything with
hidden oil. Weighing beats photographing, on the days you care about the number.

## Your data

Everything lives in `localStorage` under `monarch.v1`, on your device only.
Nothing is uploaded. Use the backup export in Status before clearing your
browser, reinstalling, or switching phones.
