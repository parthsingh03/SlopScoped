/* SlopScoped engine — pure analysis, no fetching.
   Input per repo: {
     name, htmlUrl, fork, sizeKb, createdAt, defaultBranch,
     treePaths: [ "path", ... ],
     commits: [ { message, date } ],           // newest first, up to 100
     readmeText: string|null,
     samples: [ { path, text } ],              // up to 3 code files
     suspicious: [ { path, text } ]            // .bat/.sh/prompt file contents
   }
   Output: { score, verdict, proven, evidence: [{points, label}], codeFiles, weight }
*/
(function (global) {
  'use strict';

  var CODE_EXT = /\.(py|js|ts|jsx|tsx|java|kt|kts|c|cpp|h|hpp|cs|go|rb|php|rs|swift|html|css|scss|sh|bat|ps1|sql|r|lua|pl|dart|vue|svelte)$/i;
  var AI_TELLS = ['robust', 'seamless', 'cutting-edge', 'cutting edge', 'comprehensive',
    'delve', 'elevate', 'streamline', 'leverage', 'state-of-the-art', 'state of the art',
    'powerful and flexible', 'effortless', 'supercharge', 'unleash', 'game-changer',
    'game changer', 'in today\'s fast-paced', 'look no further', 'welcome to'];

  function isCode(p) { return CODE_EXT.test(p); }

  function verdictFor(score, proven) {
    if (proven) return 'Proven AI-automated';
    if (score >= 80) return 'Highly likely AI-automated';
    if (score >= 50) return 'Likely AI-generated';
    if (score >= 25) return 'AI-assisted';
    return 'No strong AI evidence';
  }

  function analyzeRepo(r) {
    var ev = [];
    var score = 0;
    var proven = false;
    var paths = r.treePaths || [];
    var lower = paths.map(function (p) { return p.toLowerCase(); });
    var codeFiles = paths.filter(isCode).length;

    /* ---- hard evidence ---- */
    (r.suspicious || []).forEach(function (f) {
      var t = (f.text || '').toLowerCase();
      var mentionsAI = /(chatgpt|claude|antigravity|copilot|gpt[-\s]?[0-9]?|gemini|ai agent|the agent|llm)/.test(t);
      var generates = /(generate|create|write|make)\s+(\d+|five|ten|new)/.test(t);
      var gitPush = /git\s+(add|commit|push)/.test(t);
      if (mentionsAI && generates && gitPush) {
        proven = true;
        ev.push({ points: 95, label: 'Automation script "' + f.path + '" tells an AI agent to generate code and git-push it', hard: true });
      } else if (mentionsAI && gitPush) {
        score += 30;
        ev.push({ points: 30, label: 'Script "' + f.path + '" references an AI tool together with git commands' });
      }
    });
    if (lower.some(function (p) { return p.indexOf('.claude/') === 0 || p.indexOf('.agents/') === 0 || p.indexOf('/.claude/') > -1 || p.indexOf('/.agents/') > -1; })) {
      score += 35;
      ev.push({ points: 35, label: 'Committed .claude/ or .agents/ agent-config directory' });
    }
    if (lower.some(function (p) { return /(^|\/)prompts?\//.test(p) || /(^|\/)prompt[^\/]*\.(txt|md)$/.test(p); })) {
      score += 20;
      ev.push({ points: 20, label: 'Committed prompt file(s) used to drive an AI' });
    }
    if (lower.some(function (p) { return /(^|\/)(claude\.md|agents\.md|\.cursorrules)$/.test(p) || p.indexOf('.cursor/') === 0; })) {
      score += 15;
      ev.push({ points: 15, label: 'AI-tool instruction file committed (CLAUDE.md / AGENTS.md / .cursorrules / .cursor/)' });
    }

    /* ---- commit behaviour (max +35) ---- */
    var commits = r.commits || [];
    var commitPts = 0;
    if (commits.length <= 2 && codeFiles >= 20 && r.commitsFetched !== false) {
      commitPts += 10;
      ev.push({ points: 10, label: 'Whole repo (' + codeFiles + ' code files) landed in ' + Math.max(1, commits.length) + ' commit(s) — no visible development history' });
    }
    if (commits.length >= 5) {
      var msgs = commits.map(function (c) { return (c.message || '').split('\n')[0].trim().toLowerCase(); });
      var counts = {};
      msgs.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
      var topMsg = '', topCount = 0;
      Object.keys(counts).forEach(function (k) { if (counts[k] > topCount) { topCount = counts[k]; topMsg = k; } });
      var repeatRatio = topCount / msgs.length;
      if (repeatRatio > 0.5 && topCount >= 5) {
        var p1 = Math.round(15 * Math.min(1, repeatRatio));
        commitPts += p1;
        ev.push({ points: p1, label: 'One commit message repeated for ' + Math.round(repeatRatio * 100) + '% of commits ("' + topMsg.slice(0, 60) + '")' });
      }
      /* Generalized batch-generation pattern — NOT tied to any one repo's
         wording: a creation verb + a quantity + a plural thing being made,
         repeated across many commits (any domain: tools, components,
         icons, pages, modules...). */
      if (msgs.length >= 10) {
        var batch = msgs.filter(function (m) {
          return /\b(add|generate|create|build|upload|introduce|implement)\b/.test(m)
            && /(\b\d+\b|\b(batch|multiple|bulk|five|ten|three|two)\b)/.test(m)
            && /\b(tools|files|components|modules|scripts|programs|utilities|apps|pages|icons|features|functions|projects|templates|examples|items|assets|images|models|tests|endpoints|commands|plugins|widgets|levels|questions)\b/.test(m);
        });
        if (batch.length / msgs.length >= 0.25) {
          commitPts += 15;
          ev.push({ points: 15, label: Math.round(batch.length / msgs.length * 100) + '% of commits follow a batch-generation pattern (e.g. "' + batch[0].slice(0, 60) + '") — a pipeline making N things per run' });
        }
        /* One commit template with small cosmetic variations — machines
           reuse a template; humans reword organically. Numbers, feat:
           prefixes, "(Daily Update)" suffixes etc. are stripped away. */
        var norm = function (m) {
          return m.replace(/^(feat|fix|chore|docs|style|refactor|test|build|ci)(\([^)]*\))?:\s*/, '')
            .replace(/\d+/g, '#').replace(/\([^)]*\)/g, '')
            .replace(/\.(md|txt|json)\b/g, '').replace(/[^a-z# ]/g, ' ')
            .replace(/\s+/g, ' ').trim();
        };
        var templates = {};
        msgs.forEach(function (m, i) {
          var t = norm(m);
          if (!templates[t]) templates[t] = { count: 0, variants: {} };
          templates[t].count++; templates[t].variants[m] = true;
        });
        var topT = '', topTC = 0, topTV = 0;
        Object.keys(templates).forEach(function (t) {
          if (templates[t].count > topTC) { topTC = templates[t].count; topT = t; topTV = Object.keys(templates[t].variants).length; }
        });
        if (topTC / msgs.length >= 0.2 && topTV >= 3 && repeatRatio <= 0.5) {
          commitPts += 10;
          ev.push({ points: 10, label: 'One commit template accounts for ' + Math.round(topTC / msgs.length * 100) + '% of commits in ' + topTV + ' near-identical variants ("' + topT.slice(0, 60) + '")' });
        }
      }
      var days = {};
      commits.forEach(function (c) { days[(c.date || '').slice(0, 10)] = true; });
      var dayCount = Object.keys(days).length;
      if (dayCount <= 3 && dayCount > 0 && commits.length >= 10 && codeFiles > 30) {
        commitPts += 10;
        ev.push({ points: 10, label: 'Commits squeezed into ' + dayCount + ' day(s) despite ' + codeFiles + ' code files — dump, not development' });
      }
      var fixRatio = msgs.filter(function (m) { return /\b(fix|bug|debug|typo|oops|hotfix|patch|repair|broken)\b/.test(m); }).length / msgs.length;
      if (fixRatio < 0.02 && commits.length >= 20) {
        commitPts += 5;
        ev.push({ points: 5, label: 'Almost no fix/debug commits (' + Math.round(fixRatio * 100) + '%) across ' + commits.length + ' commits — code never seems to break' });
      }
      /* human signals */
      if (fixRatio >= 0.15 && fixRatio <= 0.6) {
        score -= 10;
        ev.push({ points: -10, label: 'Healthy fix/debug commit share (' + Math.round(fixRatio * 100) + '%) — humans break and repair things' });
      }
      var uniqueRatio = Object.keys(counts).length / msgs.length;
      var spanDays = commits.length > 1 ? (new Date(commits[0].date) - new Date(commits[commits.length - 1].date)) / 86400000 : 0;
      if (spanDays > 90 && uniqueRatio > 0.8) {
        score -= 10;
        ev.push({ points: -10, label: 'Long, varied commit history (' + Math.round(spanDays) + ' days, ' + Math.round(uniqueRatio * 100) + '% unique messages)' });
      }
    }
    score += Math.min(35, commitPts);

    /* ---- code & README patterns (max +30) ---- */
    var patternPts = 0;
    var samples = r.samples || [];
    if (samples.length >= 2) {
      var firstLines = samples.map(function (s) {
        var lines = (s.text || '').split('\n').filter(function (l) {
          var t = l.trim();
          return t.length > 3 && !/^(import|from|require|using|package)\b/.test(t);
        }).slice(0, 3).join(' ').trim();
        return lines.length >= 30 ? lines : '';
      });
      var shared = firstLines.filter(function (l, i) { return l && firstLines.indexOf(l) !== i; });
      if (shared.length) {
        patternPts += 10;
        ev.push({ points: 10, label: 'Sampled code files open with an identical comment/docstring template' });
      }
      var totalLines = 0, commentLines = 0, genericHits = 0;
      samples.forEach(function (s) {
        (s.text || '').split('\n').forEach(function (l) {
          var t = l.trim();
          if (!t) return;
          totalLines++;
          if (/^(\/\/|#|\/\*|\*)/.test(t)) {
            commentLines++;
            if (/(this (function|method|class|script)|this function is used to|in this (file|section)|here we|this code)/i.test(t)) genericHits++;
          }
        });
      });
      if (totalLines > 100 && commentLines / totalLines > 0.25 && genericHits >= 3) {
        patternPts += 10;
        ev.push({ points: 10, label: 'High generic-comment density in sampled code (' + Math.round(commentLines / totalLines * 100) + '% comments, template phrasing)' });
      }
    }
    if (r.readmeText) {
      var rm = r.readmeText.toLowerCase();
      var tells = AI_TELLS.filter(function (w) { return rm.indexOf(w) > -1; });
      var emojiHeaders = (r.readmeText.match(/^#{1,3}\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gmu) || []).length;
      if (tells.length + emojiHeaders >= 4) {
        patternPts += 10;
        var parts = [];
        if (tells.length) parts.push('buzzwords: ' + tells.slice(0, 4).join(', '));
        if (emojiHeaders) parts.push(emojiHeaders + ' emoji section headers');
        ev.push({ points: 10, label: 'README shows ' + (tells.length + emojiHeaders) + ' AI-template tells (' + parts.join('; ') + ')' });
      }
    }
    if (codeFiles > 100) {
      var topLevel = paths.filter(function (p) { return p.indexOf('/') === -1 && isCode(p); }).length;
      if (topLevel / codeFiles > 0.7) {
        patternPts += 10;
        ev.push({ points: 10, label: codeFiles + ' code files in a flat layout — hundreds of files in one pile is a bulk-generation pattern' });
      }
    }
    score += Math.min(30, patternPts);

    if (proven) score = Math.max(score, 95);
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      name: r.name, htmlUrl: r.htmlUrl, score: score, proven: proven,
      verdict: verdictFor(score, proven), evidence: ev,
      codeFiles: codeFiles, totalFiles: paths.length,
      commits: commits.length, weight: Math.max(1, codeFiles, Math.round((r.sizeKb || 0) / 50))
    };
  }

  function analyzeProfile(username, repoResults, forkCount) {
    var totalW = 0, sum = 0;
    repoResults.forEach(function (r) { totalW += r.weight; sum += r.score * r.weight; });
    var score = totalW ? Math.round(sum / totalW) : 0;
    return {
      username: username, score: score,
      low: Math.max(0, score - 10), high: Math.min(100, score + 10),
      verdict: verdictFor(score, repoResults.some(function (r) { return r.proven; })),
      repos: repoResults, forkCount: forkCount || 0
    };
  }

  global.SlopEngine = { analyzeRepo: analyzeRepo, analyzeProfile: analyzeProfile, verdictFor: verdictFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SlopEngine;
})(typeof window !== 'undefined' ? window : globalThis);
