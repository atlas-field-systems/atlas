// Shows whether this is main or a pull request preview, with links to the other versions.
(async () => {
  const m = location.pathname.match(/^(.*?\/)pr\/pr-(\d+)\//);
  const root = m ? m[1] : location.pathname.replace(/[^/]*$/, '');
  const here = m ? Number(m[2]) : null;
  let prs = [];
  try { prs = await (await fetch('pull-requests.json')).json(); } catch {}
  prs = Array.isArray(prs) ? prs.filter((p) => Number.isInteger(p?.number) && p.number > 0 && typeof p.title === 'string') : [];
  if (!here && !prs.length) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const link = (href, label, on) => (on ? `<b>${esc(label)}</b>` : `<a href="${esc(href)}">${esc(label)}</a>`);
  const div = document.createElement('div');
  div.className = here ? 'branch' : 'branch main';
  div.innerHTML = (here ? `Preview of pull request <a href="https://github.com/atlas-field-systems/monorepo/pull/${here}">#${here}</a> (work in progress, not on main). ` : 'Showing main. ') +
    'Versions: ' + link(root, 'main', !here) + prs.map((p) => link(`${root}pr/pr-${p.number}/`, `#${p.number} ${p.title}`, p.number === here)).join(' ');
  document.body.prepend(div);
})();
