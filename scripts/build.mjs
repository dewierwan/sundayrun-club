// Builds the site into dist/.
//
// Reads every event in events.json from its public Partiful page, reads the
// shared Google Photos album, downloads posters and photos, and writes
// index.html plus the /next, /photos and /chat short links.
//
// Any failure exits non-zero, so a broken build never replaces the live site.
// Usage: node scripts/build.mjs

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const PAST = join(ROOT, 'past');
const SITE = 'https://sundayrun.club';
const ALBUM_URL = 'https://photos.app.goo.gl/6V19nvmFXAsfoa4H8';
const CHAT_URL = 'https://chat.whatsapp.com/GkPHJlDMQ7TGcaS0tklQyT';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function get(url, { binary = false, ua = UA } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: ua ? { 'user-agent': ua } : {}, redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (attempt >= 3) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Run fn over items with limited concurrency, keeping order.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n], n);
      }
    }),
  );
  return out;
}

const ended = (e) => (e.end ? Date.parse(e.end) : Date.parse(e.start) + 90 * 60000) <= Date.now();

// Finished runs never change, so their details and poster are saved in past/
// the first time a build sees them ended, and read from there afterwards.
async function readEvent(id) {
  const saved = join(PAST, `${id}.json`);
  if (existsSync(saved)) return { ...JSON.parse(await readFile(saved, 'utf8')), savedPoster: existsSync(join(PAST, `${id}.jpg`)) };
  const e = await fetchEvent(id);
  if (e && ended(e)) {
    if (e.posterSrc) await writeFile(join(PAST, `${id}.jpg`), await get(e.posterSrc, { binary: true }));
    const { posterSrc, ...meta } = e;
    await writeFile(saved, JSON.stringify(meta, null, 2) + '\n');
    console.log(`Saved finished run ${e.title} to past/`);
    return { ...meta, savedPoster: !!posterSrc };
  }
  return e;
}

async function fetchEvent(id) {
  const html = await get(`https://partiful.com/e/${id}`);
  if (html === null) {
    console.warn(`! Partiful event ${id} not found, skipping`);
    return null;
  }
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`No event data on Partiful page ${id}`);
  const e = JSON.parse(m[1]).props?.pageProps?.event;
  if (!e?.startDate) throw new Error(`Partiful page ${id} has no start date`);
  if (e.status && e.status !== 'PUBLISHED') {
    console.warn(`! Partiful event ${id} is ${e.status}, skipping`);
    return null;
  }
  const n = Number((e.title.match(/#(\d+)/) || [])[1] || 1);
  const path = e.image?.upload?.path;
  const posterSrc = path
    ? `https://partiful.imgix.net/${path}?w=800&h=800&fit=crop&fm=jpg&q=78`
    : null;
  return { id, n, title: e.title, start: e.startDate, end: e.endDate || null, posterSrc };
}

async function readAlbum() {
  // The short link only redirects to the album for non-browser user agents.
  const res = await fetch(ALBUM_URL, { redirect: 'manual' });
  const target = res.headers.get('location');
  if (!target) throw new Error(`Album short link did not redirect (status ${res.status})`);
  const html = await get(target);
  if (!html) throw new Error('Album page not found');
  const seen = new Set();
  const photos = [];
  const re = /\["(AF1Qip[\w-]+)",\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[\w-]+)",(\d+),(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const t = html.slice(re.lastIndex, re.lastIndex + 3000).match(/1[67]\d{11}/);
    photos.push({ src: m[2], w: +m[3], h: +m[4], taken: t ? +t[0] : 0 });
  }
  if (photos.length === 0) throw new Error('Found no photos in the album page; Google may have changed it');
  return photos;
}

// Newest run day first, alternating between days so one big day doesn't dominate.
function interleaveByDay(photos) {
  const day = (p) => new Date(p.taken).toISOString().slice(0, 10);
  const groups = new Map();
  for (const p of [...photos].sort((a, b) => a.taken - b.taken)) {
    if (!groups.has(day(p))) groups.set(day(p), []);
    groups.get(day(p)).push(p);
  }
  const lists = [...groups.keys()].sort().reverse().map((k) => groups.get(k));
  const out = [];
  while (lists.some((l) => l.length)) for (const l of lists) if (l.length) out.push(l.shift());
  return out;
}

function redirectPage(target, { title, image } = {}) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title || 'Sunday Run Club')}</title>
<meta property="og:title" content="${esc(title || 'Sunday Run Club')}">
<meta property="og:description" content="9am, Golden Fire Hydrant, every Sunday.">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
</head>
<body><a href="${esc(target)}">${esc(target)}</a></body>
</html>
`;
}

// /next picks the first run that hasn't ended at the moment someone opens it,
// so it moves on by itself after each Sunday. The build-time choice is only a
// fallback for clients without JavaScript.
function nextPage(events, fallback) {
  const list = JSON.stringify(events.map((e) => [e.id, e.start, e.end]));
  const image = fallback ? `${SITE}/img/posters/${fallback.id}.jpg` : null;
  const target = fallback ? `https://partiful.com/e/${fallback.id}` : SITE + '/';
  return redirectPage(target, { title: 'Sunday Run Club: next run', image }).replace(
    '<meta http-equiv',
    `<script>
(function () {
  var now = Date.now();
  var runs = ${list};
  for (var i = 0; i < runs.length; i++) {
    var end = runs[i][2] ? Date.parse(runs[i][2]) : Date.parse(runs[i][1]) + 90 * 60000;
    if (end > now) { location.replace('https://partiful.com/e/' + runs[i][0]); return; }
  }
  location.replace('/');
})();
</script>
<meta http-equiv`,
  );
}

async function main() {
  const ids = JSON.parse(await readFile(join(ROOT, 'events.json'), 'utf8'));
  const template = await readFile(join(ROOT, 'src/index.html'), 'utf8');

  await mkdir(PAST, { recursive: true });
  const [events, albumPhotos] = await Promise.all([
    pool([...new Set(ids)], 6, readEvent).then((list) =>
      list.filter(Boolean).sort((a, b) => a.start.localeCompare(b.start)),
    ),
    readAlbum(),
  ]);
  console.log(`${events.length} events, ${albumPhotos.length} photos`);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'img/posters'), { recursive: true });
  await mkdir(join(DIST, 'img/photos'), { recursive: true });

  const withPosters = await pool(events, 6, async ({ savedPoster, ...e }) => {
    const file = `img/posters/${e.id}.jpg`;
    if (savedPoster) await copyFile(join(PAST, `${e.id}.jpg`), join(DIST, file));
    else if (e.posterSrc) await writeFile(join(DIST, file), await get(e.posterSrc, { binary: true }));
    else return { ...e, poster: null };
    return { ...e, poster: file };
  });

  const photos = await pool(interleaveByDay(albumPhotos), 8, async (p, i) => {
    const file = `img/photos/${String(i).padStart(3, '0')}.jpg`;
    await writeFile(join(DIST, file), await get(`${p.src}=h560`, { binary: true }));
    return { src: file, w: p.w, h: p.h, date: new Date(p.taken).toISOString().slice(0, 10) };
  });

  const data = {
    events: withPosters.map(({ posterSrc, ...e }) => e),
    photos,
  };
  const now = Date.now();
  const upcoming = withPosters.filter((e) => Date.parse(e.end || e.start) + (e.end ? 0 : 90 * 60000) > now);
  const share = upcoming[0] || withPosters[withPosters.length - 1];

  const html = template
    .replace('/*DATA*/', JSON.stringify(data).replace(/</g, '\\u003c'))
    .replaceAll('{{OG_IMAGE}}', share?.poster ? `${SITE}/${share.poster}` : '');
  await writeFile(join(DIST, 'index.html'), html);

  for (const [dir, page] of [
    ['next', nextPage(withPosters, upcoming[0])],
    ['photos', redirectPage(ALBUM_URL, { title: 'Sunday Run Club photos' })],
    ['chat', redirectPage(CHAT_URL, { title: 'Sunday Run Club WhatsApp group' })],
  ]) {
    await mkdir(join(DIST, dir), { recursive: true });
    await writeFile(join(DIST, dir, 'index.html'), page);
  }
  await writeFile(join(DIST, 'CNAME'), 'sundayrun.club\n');
  await writeFile(join(DIST, '.nojekyll'), '');
  console.log(`Built dist/ (next run: ${upcoming[0]?.title || 'none scheduled'})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
