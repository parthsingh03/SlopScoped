# SlopScoped

How much of a GitHub profile is actually AI?

Paste a username and SlopScoped reads the public record — file trees,
commit history, READMEs, a sample of the code — and estimates how much
of the profile is AI-made. Every point in the score is tied to evidence
you can click and check yourself.

**Live:** https://parthsingh03.github.io/SlopScoped/

## The URL swap

Take any GitHub profile and swap the domain:

```
github.com/Ayush442842q  →  parthsingh03.github.io/SlopScoped/Ayush442842q
```

## What it looks for

- **Hard proof** — committed automation scripts that tell an AI agent to
  generate code and push it, `.claude/` / `.agents/` folders, prompt files
- **Commit behaviour** — the same message repeated for most commits,
  "add 5 new tools" batch-generation patterns, whole repos landing in
  one commit, almost no fix commits ever
- **Code & README patterns** — identical templates across files, generic
  comment padding, AI-buzzword READMEs
- **Human signals subtract points** — real fix/debug history, long
  varied commit history

Forks are excluded from the score. A fork is someone else's work.

The full rules are in [SCORING.md](SCORING.md) — weights, verdict
bands, everything. The scoring is deterministic: same profile, same
score, no AI guessing involved in the judging.

## Honest limits

This is an estimator, not a lie detector. A low score means **no strong
public evidence** — not "proven human". Careful AI-assisted work that
was iterated locally and pushed finished leaves few public traces, and
SlopScoped will not invent traces that aren't there.

## Run it locally

It's a static site — no build step, no backend:

```
python3 -m http.server 8000
# open http://localhost:8000
```

Unauthenticated GitHub API allows 60 requests/hour per IP; one profile
scan uses roughly 2 requests per repo (max 12 repos deep-scanned).

## Layout

- `index.html` / `styles.css` — the page
- `app.js` — GitHub fetching + rendering
- `engine.js` — the scoring engine (pure functions, runs in Node too)
- `test/fetch-and-score.mjs` — verification harness: scores a real
  profile from Node and prints the evidence
