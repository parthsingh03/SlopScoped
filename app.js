/* SlopScoped app — fetches public GitHub data in the browser and
   hands it to engine.js (window.SlopEngine). Same pipeline as the
   node verification harness in test/fetch-and-score.mjs. */
(function () {
  'use strict';
  var GH = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com';
  var CODE = /\.(py|js|ts|jsx|tsx|java|kt|c|cpp|cs|go|rb|php|rs|html|css)$/i;

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
    if (res.status === 404) throw new Error('GitHub user not found (or a repo vanished mid-scan).');
    if (res.status === 403) throw new Error('GitHub API rate limit hit (60 scans/hour unauthenticated). Wait a bit and try again.');
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

  async function scan(username) {
    landing.hidden = true; result.hidden = true; scanning.hidden = false;
    $('scan-user').textContent = username;
    $('scan-log').textContent = '';
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
        var r = own[i];
        log('scoping ' + r.name + ' …');
        var tree = { tree: [] }, commits = [];
        try { tree = await gh('/repos/' + username + '/' + r.name + '/git/trees/' + r.default_branch + '?recursive=1'); } catch (e) { /* keep empty */ }
        try { commits = await gh('/repos/' + username + '/' + r.name + '/commits?per_page=100'); } catch (e) { /* keep empty */ }
        var paths = (tree.tree || []).filter(function (t) { return t.type === 'blob'; }).map(function (t) { return t.path; });
        var suspiciousPaths = paths.filter(function (p) { return /\.(bat|sh|ps1)$/i.test(p) || /(^|\/)prompt[^/]*\.(txt|md)$/i.test(p); }).slice(0, 3);
        var suspicious = [];
        for (var s = 0; s < suspiciousPaths.length; s++) {
          var st = await raw(username, r.name, r.default_branch, suspiciousPaths[s]);
          if (st) suspicious.push({ path: suspiciousPaths[s], text: st });
        }
        var readmePath = paths.filter(function (p) { return /^readme\.md$/i.test(p); })[0];
        var readmeText = readmePath ? await raw(username, r.name, r.default_branch, readmePath) : null;
        var samplePaths = paths.filter(function (p) { return CODE.test(p) && !/readme/i.test(p); }).slice(0, 3);
        var samples = [];
        for (var k = 0; k < samplePaths.length; k++) {
          var tt = await raw(username, r.name, r.default_branch, samplePaths[k]);
          if (tt) samples.push({ path: samplePaths[k], text: tt });
        }
        var out = window.SlopEngine.analyzeRepo({
          name: r.name, htmlUrl: r.html_url, fork: r.fork, sizeKb: r.size,
          createdAt: r.created_at, defaultBranch: r.default_branch,
          treePaths: paths,
          commits: (commits || []).map(function (c) { return { message: c.commit.message, date: c.commit.author.date }; }),
          readmeText: readmeText, samples: samples, suspicious: suspicious
        });
        log('  → ' + out.score + '/100 · ' + out.verdict);
        results.push(out);
      }
      var profile = window.SlopEngine.analyzeProfile(username, results, forks.length);
      render(profile);
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

  function render(p) {
    scanning.hidden = true; result.hidden = false;
    $('profile-title').textContent = p.username + ' — SlopScoped';
    $('score-num').textContent = p.score;
    $('score-range').textContent = 'range ' + p.low + '–' + p.high + '% · weighted by repo size';
    var pv = $('profile-verdict');
    pv.textContent = p.verdict;
    pv.className = 'verdict ' + verdictClass(p.score, p.repos.some(function (r) { return r.proven; }));
    $('profile-meta').textContent = p.repos.length + ' repos deep-scanned · ' + p.forkCount + ' forks excluded';
    var wrap = $('repo-cards');
    wrap.innerHTML = '';
    p.repos.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (r) {
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
      wrap.appendChild(card);
    });
    window.scrollTo(0, 0);
  }

  function start() {
    var u = $('user-input').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/.*$/, '');
    if (!u) { showError('Type a GitHub username first.'); return; }
    $('error').hidden = true;
    scan(u);
  }
  $('go').addEventListener('click', start);
  $('user-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') start(); });
  document.querySelectorAll('.example').forEach(function (b) {
    b.addEventListener('click', function () { $('user-input').value = b.dataset.user; start(); });
  });

  var params = new URLSearchParams(location.search);
  var u = params.get('u');
  if (u) { $('user-input').value = u; scan(u); }
})();
