# SlopScoped — Scoring Plan v1

SlopScoped estimates how much of a public GitHub profile is AI-made.
It is an estimator, not a lie detector: every score ships with the evidence
that produced it, and the headline number is a range, never fake precision.

## What is scanned

- All public repos of the user. **Forks are excluded** from the score
  (a fork is someone else's work) and only counted separately.
- Empty repos are excluded. At most 12 non-fork repos are deep-scanned
  (largest first) to stay inside GitHub's unauthenticated API budget.

Per repo we read: the file tree, up to 100 commit messages + dates,
the README, a sample of up to 3 code files, and the content of any
suspicious automation files (`.bat`/`.sh` scripts, prompt files).

## Signals (per repo, 0–100)

### Hard evidence (can prove automation)
- An automation script whose content tells an AI/agent to generate code
  AND commit/push it → **score floor 95,
  verdict PROVEN AI-AUTOMATED**.
- `.claude/` or `.agents/` directory committed → +35
- Prompt files (`prompt*.txt/md`, `prompts/`) → +20
- `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor/` → +15

### Commit behaviour (max +35)
- Whole repo (≥20 code files) landed in ≤2 commits → +10
- One commit message repeated for >50% of commits → up to +15
- Batch-generation pattern in ≥25% of commits → +15. Deliberately
  generic (learned the hard way — v1 hard-coded one repo's wording,
  which was overfitting): a creation verb (add/generate/create/build/
  upload/introduce/implement) + a quantity (a number, or batch/
  multiple/bulk) + a plural thing being made (tools, files,
  components, modules, icons, pages, features, … — any domain)
- One commit template in ≥3 near-identical variants making up ≥20%
  of commits → +10 (numbers, `feat:` prefixes and suffixes stripped
  before comparing — pipelines reuse templates, humans reword)
- ≥70% of commits land on ≤3 distinct days while the repo has >30
  files → +10
- Almost no fix/debug commits (<2% of ≥20 commits) → +5

### Code & README patterns (max +30)
- Sampled code files share an identical comment/docstring template → +10
- Very high generic-comment density in sampled code → up to +10
- README hits ≥4 AI-template tells (buzzwords like "robust / seamless /
  cutting-edge / comprehensive", emoji section headers, badge walls) → +10
- >100 code files in a flat, unrelated-tools layout → +10

### Human signals (subtract, max −20)
- Fix/bug/typo/WIP commits in a plausible human band (15–60%) → −10
- Commit history spans >90 days with varied messages (unique ratio
  >0.8) → −10

## Verdict bands (per repo)

- 0–24 → No strong AI evidence (NOT "proven human" — careful
  AI-assisted work that was iterated locally and pushed finished
  leaves few public traces, and this tool only reports what the
  public record shows)
- 25–49 → AI-assisted
- 50–79 → Likely AI-generated
- 80–100 → Highly likely AI-automated
- Hard-evidence script found → Proven AI-automated (any score)

## Profile score

Weighted average of repo scores, weighted by code-file count (a
950-file repo says more about a profile than a 3-file repo).
Shown as a range: score ±10, clamped to 0–100.
Every repo card lists its evidence with links, so anyone can audit
the number. No evidence → no accusation.
