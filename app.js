/* SlopScoped app — fetches public GitHub data in the browser and
   hands it to engine.js (window.SlopEngine). Two modes:
   profile (a whole user) and single repo (owner/repo).
   Same pipeline as the node harness in test/fetch-and-score.mjs. */
(function () {
  'use strict';
  var GH = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com';
  var CODE = /\.(py|js|ts|jsx|tsx|java|kt|c|cpp|cs|go|rb|php|rs|html|css)$/i;
  var mode = 'profile';

  var $ = function (id) { return document.getElementById(id); };
  var landing = $('landing'), scanning = $('scanning'), result = $('result');

  function showError(msg) {
    var e = $('error');
    e.textContent = msg;
    e.hidden = false;
  }
  function log(line) {
    var el = $('scan-log');
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
  }

  async function gh(path) {
    var res = await fetch(GH + path, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (res.status === 404) throw new Error('Not found on GitHub — check the spelling.');
    if (res.status === 403) throw new Error('GitHub API rate limit hit (60 requests/hour unauthenticated). Wait a bit and try again.');
    if (!res.ok) throw new Error('GitHub API error ' + res.status + ' on ' + path);
    return res.json();
  }
  async function raw(owner, repo, branch, path) {
    try {
      var res = await fetch(RAW + '/' + owner + '/' + repo + '/' + branch + '/' + path.split('/').map(encodeURIComponent).join('/'));
      if (!res.ok) return null;
      var t = await res.text();
      return t.length > 60000 ? t.slice(0, 60000) : t;
    } catch (e) { return null; }
  }

  /* Score one repo (meta object from the GitHub API) for an owner. */
  async function scopeOne(owner, r) {
    var tree = { tree: [] }, commits = [], commitsFetched = true;
    try { tree = await gh('/repos/' + owner + '/' + r.name + '/git/trees/' + r.default_branch + '?recursive=1'); } catch (e) { /* keep empty */ }
    try { commits = await gh('/repos/' + owner + '/' + r.name + '/commits?per_page=100'); } catch (e) { commitsFetched = false; }
    var paths = (tree.tree || []).filter(function (t) { return t.type === 'blob'; }).map(function (t) { return t.path; });
    var suspiciousPaths = paths.filter(function (p) { return /\.(bat|sh|ps1)$/i.test(p) || /(^|\/)prompt[^/]*\.(txt|md)$/i.test(p); }).slice(0, 3);
    var suspicious = [];
    for (var s = 0; s < suspiciousPaths.length; s++) {
      var st = await raw(owner, r.name, r.default_branch, suspiciousPaths[s]);
      if (st) suspicious.push({ path: suspiciousPaths[s], text: st });
    }
    var readmePath = paths.filter(function (p) { return /^readme\.md$/i.test(p); })[0];
    var readmeText = readmePath ? await raw(owner, r.name, r.default_branch, readmePath) : null;
    var samplePaths = paths.filter(function (p) { return CODE.test(p) && !/readme/i.test(p); }).slice(0, 3);
    var samples = [];
    for (var k = 0; k < samplePaths.length; k++) {
      var tt = await raw(owner, r.name, r.default_branch, samplePaths[k]);
      if (tt) samples.push({ path: samplePaths[k], text: tt });
    }
    return window.SlopEngine.analyzeRepo({
      name: r.name, htmlUrl: r.html_url, fork: r.fork, sizeKb: r.size,
      createdAt: r.created_at, defaultBranch: r.default_branch,
      treePaths: paths,
      commitsFetched: commitsFetched,
      commits: (commits || []).map(function (c) { return { message: c.commit.message, date: c.commit.author.date }; }),
      readmeText: readmeText, samples: samples, suspicious: suspicious
    });
  }

  function beginScan(label) {
    landing.hidden = true; result.hidden = true; scanning.hidden = false;
    $('scan-user').textContent = label;
    $('scan-log').textContent = '';
  }

  async function scan(username) {
    beginScan(username);
    try {
      log('fetching repos of ' + username + ' …');
      var repos = await gh('/users/' + encodeURIComponent(username) + '/repos?per_page=100&sort=pushed');
      var forks = repos.filter(function (r) { return r.fork; });
      var own = repos.filter(function (r) { return !r.fork && r.size > 0; })
        .sort(function (a, b) { return b.size - a.size; }).slice(0, 12);
      log(repos.length + ' repos · ' + forks.length + ' forks excluded · deep-scanning ' + own.length);
      if (!own.length) throw new Error('No non-fork public repos with code to scope.');
      var results = [];
      for (var i = 0; i < own.length; i++) {
        log('scoping ' + own[i].name + ' …');
        var out = await scopeOne(username, own[i]);
        log('  → ' + out.score + '/100 · ' + out.verdict);
        results.push(out);
      }
      renderProfile(window.SlopEngine.analyzeProfile(username, results, forks.length));
    } catch (err) {
      scanning.hidden = true; landing.hidden = false;
      showError(err.message || String(err));
    }
  }

  async function scanRepo(owner, repoName) {
    beginScan(owner + '/' + repoName);
    try {
      log('fetching repo ' + owner + '/' + repoName + ' …');
      var meta = await gh('/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repoName));
      if (meta.fork) log('note: this repo is a fork — scoring it anyway because you asked for this repo specifically.');
      if (!meta.size) throw new Error('That repo looks empty — nothing to scope.');
      var out = await scopeOne(owner, meta);
      log('  → ' + out.score + '/100 · ' + out.verdict);
      renderSingle(owner, out);
    } catch (err) {
      scanning.hidden = true; landing.hidden = false;
      showError(err.message || String(err));
    }
  }

  function verdictClass(score, proven) {
    if (proven) return 'v-proven';
    if (score >= 50) return 'v-high';
    if (score >= 25) return 'v-mid';
    return 'v-low';
  }

  function repoCard(r) {
    var card = document.createElement('article');
    card.className = 'card';
    var head = document.createElement('div');
    head.className = 'card-head';
    var name = document.createElement('a');
    name.href = r.htmlUrl; name.target = '_blank'; name.rel = 'noopener';
    name.textContent = r.name;
    var badge = document.createElement('span');
    badge.className = 'badge ' + verdictClass(r.score, r.proven);
    badge.textContent = r.score + '/100 · ' + r.verdict;
    head.appendChild(name); head.appendChild(badge);
    card.appendChild(head);
    var meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = r.codeFiles + ' code files · ' + r.totalFiles + ' files total · ' + r.commits + ' commits scanned';
    card.appendChild(meta);
    if (r.evidence.length) {
      var ul = document.createElement('ul');
      ul.className = 'evidence';
      r.evidence.forEach(function (e) {
        var li = document.createElement('li');
        var pts = document.createElement('span');
        pts.className = 'pts ' + (e.points < 0 ? 'neg' : 'pos');
        pts.textContent = (e.points > 0 ? '+' : '') + e.points;
        li.appendChild(pts);
        li.appendChild(document.createTextNode(' ' + e.label));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    } else {
      var none = document.createElement('p');
      none.className = 'meta';
      none.textContent = 'No signals found in the public record for this repo.';
      card.appendChild(none);
    }
    return card;
  }

  function showResult(title, score, rangeText, verdict, proven, metaText, cards) {
    scanning.hidden = true; result.hidden = false;
    $('profile-title').textContent = title;
    $('score-num').textContent = score;
    $('score-range').textContent = rangeText;
    var pv = $('profile-verdict');
    pv.textContent = verdict;
    pv.className = 'verdict ' + verdictClass(score, proven);
    $('profile-meta').textContent = metaText;
    var wrap = $('repo-cards');
    wrap.innerHTML = '';
    cards.forEach(function (c) { wrap.appendChild(c); });
    var h2 = result.querySelector('h2');
    if (h2) h2.textContent = cards.length > 1 ? 'Repo by repo' : 'The evidence';
    window.scrollTo(0, 0);
  }

  function renderProfile(p) {
    var cards = p.repos.slice().sort(function (a, b) { return b.score - a.score; }).map(repoCard);
    showResult(
      p.username + ' — SlopScoped', p.score,
      'range ' + p.low + '–' + p.high + '% · weighted by repo size',
      p.verdict, p.repos.some(function (r) { return r.proven; }),
      p.repos.length + ' repos deep-scanned · ' + p.forkCount + ' forks excluded',
      cards
    );
  }

  function renderSingle(owner, out) {
    showResult(
      owner + '/' + out.name + ' — SlopScoped', out.score,
      'single-repo score · no profile weighting',
      out.verdict, out.proven,
      'one repo deep-scanned on its own public record',
      [repoCard(out)]
    );
  }

  /* ---- mode toggle ---- */
  function setMode(m) {
    mode = m;
    $('mode-profile').classList.toggle('active', m === 'profile');
    $('mode-repo').classList.toggle('active', m === 'repo');
    $('user-input').placeholder = m === 'profile' ? 'github username' : 'owner/repo or a repo URL';
    document.querySelectorAll('.profile-example').forEach(function (b) { b.hidden = m !== 'profile'; });
    document.querySelectorAll('.repo-example').forEach(function (b) { b.hidden = m !== 'repo'; });
    $('error').hidden = true;
  }
  $('mode-profile').addEventListener('click', function () { setMode('profile'); });
  $('mode-repo').addEventListener('click', function () { setMode('repo'); });

  function cleanInput() {
    return $('user-input').value.trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '').replace(/\/+$/, '');
  }
  function start() {
    var v = cleanInput();
    if (!v) { showError(mode === 'profile' ? 'Type a GitHub username first.' : 'Type a repo as owner/repo first.'); return; }
    $('error').hidden = true;
    if (mode === 'profile') {
      scan(v.split('/')[0]);
    } else {
      var parts = v.split('/').filter(Boolean);
      if (parts.length !== 2) { showError('Single-repo mode needs owner/repo — e.g. parthsingh03/AirGap.'); return; }
      scanRepo(parts[0], parts[1]);
    }
  }
  $('go').addEventListener('click', start);
  $('user-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') start(); });
  document.querySelectorAll('.example').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.user) { setMode('profile'); $('user-input').value = b.dataset.user; }
      else { setMode('repo'); $('user-input').value = b.dataset.repo; }
      start();
    });
  });

  var params = new URLSearchParams(location.search);
  var u = params.get('u'), rParam = params.get('r');
  if (rParam && rParam.indexOf('/') > -1) {
    setMode('repo');
    $('user-input').value = rParam;
    var rp = rParam.split('/');
    scanRepo(rp[0], rp[1]);
  } else if (u) {
    $('user-input').value = u;
    scan(u);
  }
})();
