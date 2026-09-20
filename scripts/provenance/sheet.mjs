/**
 * The provenance sheet.
 *
 * The artwork in `src/assets/source/` arrived stripped: no EXIF author, no
 * filename, no sidecar. Tracing it is a reverse-image-search job, and every
 * service that is any good at anime fan art either wants a paid API key
 * (SauceNAO) or blocks scripted requests outright (ascii2d). So the machine
 * does the half it can do - laying every image out with the searches
 * pre-aimed, and turning the answers back into valid `gallery.meta.json` - and
 * a human does the half that needs a browser.
 *
 * Everything here is pure and string-in/string-out so it can be tested without
 * a browser. `mergeCredits` is shipped into the page via `toString()` rather
 * than duplicated, so the JSON the sheet emits is produced by the same code the
 * test suite checks.
 */

/** Where each service wants you to land. None of them take a local file by URL. */
export const SERVICES = [
  {
    id: 'lens',
    name: 'Google Lens',
    href: 'https://lens.google.com/upload',
    note: 'Widest net. Best first try.',
  },
  {
    id: 'saucenao',
    name: 'SauceNAO',
    href: 'https://saucenao.com/',
    note: 'Indexes pixiv and Twitter. Best odds for fan art.',
  },
  {
    id: 'ascii2d',
    name: 'ascii2d',
    href: 'https://ascii2d.net/',
    note: 'Japanese art specialist. Try the colour and bovw tabs.',
  },
  {
    id: 'tineye',
    name: 'TinEye',
    href: 'https://tineye.com/',
    note: 'Finds the oldest copy, which is often the artist.',
  },
];

/**
 * Folds traced answers back into the metadata file.
 *
 * Deliberately non-destructive: an id with no artist is left exactly as it was
 * rather than being stamped with an empty credit, so a half-finished pass can
 * be pasted in without wiping the work from the previous one. Entries that
 * exist only in `answers` are appended, because the sheet is also how a newly
 * dropped image gets its first credit.
 *
 * @param {Record<string, unknown>} meta Parsed gallery.meta.json, `_comment` keys and all.
 * @param {Record<string, {artist?: string, url?: string, license?: string}>} answers
 * @returns {Record<string, unknown>} A new object. `meta` is not mutated.
 */
export function mergeCredits(meta, answers) {
  const clean = (value) => (typeof value === 'string' ? value.trim() : '');
  const out = {};

  const applyTo = (id, entry) => {
    const answer = answers[id];
    const artist = clean(answer && answer.artist);

    // No artist means "not traced yet", not "traced to nobody". Clearing a
    // credit is a deliberate edit of the file, never a side effect of an
    // unfinished sheet.
    if (!artist) return entry;

    const url = clean(answer.url);
    const license = clean(answer.license);
    const credit = { artist };
    if (url) credit.url = url;
    if (license) credit.license = license;

    // Spread first so `credit` lands in a stable position rather than wherever
    // the previous edit left it, and existing title/order/transition survive.
    const { credit: _previous, ...rest } = entry && typeof entry === 'object' ? entry : {};
    return { ...rest, credit };
  };

  for (const [id, entry] of Object.entries(meta)) {
    out[id] = id.startsWith('_') ? entry : applyTo(id, entry);
  }

  for (const id of Object.keys(answers)) {
    if (id.startsWith('_') || id in out) continue;
    const entry = applyTo(id, {});
    if (entry.credit) out[id] = entry;
  }

  return out;
}

/**
 * Reads the top-level key order straight out of the raw file text.
 *
 * `JSON.parse` cannot preserve it. JavaScript hoists integer-like keys to the
 * front of an object, so "10" sorts before "07" - the leading zero is what
 * keeps the others in place - and a round trip through an object would reorder
 * the curated arc on every emit. The file is hand-ordered and that order is the
 * point, so it is read from the text and applied on the way out.
 *
 * @param {string} text Raw gallery.meta.json.
 * @returns {string[]} Top-level keys, in the order they appear in the file.
 */
export function topLevelKeys(text) {
  const keys = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        inString = false;
        // A string at depth 1 is a key only if a colon follows it. Values are
        // strings too, and `_comment` is exactly that case.
        if (depth === 1 && /^\s*:/.test(text.slice(index + 1))) {
          keys.push(JSON.parse(text.slice(start, index + 1)));
        }
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      escaped = false;
      start = index;
    } else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
  }

  return keys;
}

/**
 * Serialises the metadata with the file's own key order restored.
 *
 * @param {Record<string, unknown>} meta
 * @param {string[]} order Keys in the order they should be written. Anything
 *   missing from it is appended, so a newly credited image is never dropped.
 */
export function stringifyMeta(meta, order) {
  const seen = new Set();
  const ordered = [];

  for (const key of order) {
    if (key in meta && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of Object.keys(meta)) {
    if (!seen.has(key)) ordered.push(key);
  }

  // One line per entry, spaces inside the braces: the house style of the file
  // as it is written by hand. Matching it keeps the diff after a tracing pass
  // down to the lines that actually gained a credit.
  const compact = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
    const fields = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${compact(item)}`);
    return fields.length === 0 ? '{}' : `{ ${fields.join(', ')} }`;
  };

  const body = ordered
    .map((key, index) => {
      // The blank line under the comment is the separator between the note to
      // the editor and the data, and it is worth preserving.
      const lead = index > 0 && ordered[index - 1].startsWith('_') ? '\n' : '';
      return `${lead}  ${JSON.stringify(key)}: ${compact(meta[key])}`;
    })
    .join(',\n');

  return `{\n${body}\n}\n`;
}

/**
 * A source URL has to satisfy `z.string().url()` in content.config.ts or the
 * build fails. Catching it in the sheet turns a build break into a red field.
 */
export function isUsableSourceUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

const serviceLinks = (image) =>
  SERVICES.map(
    (service) => `
            <a class="service" href="${service.href}" target="_blank" rel="noopener noreferrer"
               title="${escapeHtml(service.note)}">${escapeHtml(service.name)}</a>`,
  ).join('');

const row = (image) => `
      <article class="row" data-row data-id="${escapeHtml(image.id)}">
        <div class="row__art">
          <img src="${image.dataUri}" alt="${escapeHtml(image.title)}" draggable="true" />
          <a class="download" href="${image.dataUri}" download="${escapeHtml(image.file)}">Save ${escapeHtml(image.file)}</a>
        </div>
        <div class="row__work">
          <header class="row__head">
            <h2>${escapeHtml(image.title)}</h2>
            <span class="row__meta">${escapeHtml(image.file)} &middot; ${image.width}&times;${image.height}</span>
            <span class="badge" data-badge>untraced</span>
          </header>
          <p class="hint">Drag the image into the search box, or save it and upload.</p>
          <nav class="services">${serviceLinks(image)}
          </nav>
          <div class="fields">
            <label>Artist
              <input type="text" data-field="artist" placeholder="pixiv display name, or Twitter handle" />
            </label>
            <label>Source URL
              <input type="url" data-field="url" placeholder="https://www.pixiv.net/artworks/..." />
            </label>
            <label>Permission / licence note
              <input type="text" data-field="license" placeholder="e.g. Used with permission, 2026-09-21" />
            </label>
          </div>
        </div>
      </article>`;

const STYLE = `
      :root { color-scheme: dark; --bg:#12121a; --panel:#1c1c27; --line:#2f2f3f; --ink:#e9e9f2; --dim:#9a9ab0; --ok:#7ee0a8; --warn:#e0b87e; }
      * { box-sizing: border-box; }
      body { margin:0; padding:2rem 1.5rem 6rem; background:var(--bg); color:var(--ink);
             font:16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .wrap { max-width: 1100px; margin: 0 auto; }
      h1 { font-size:1.6rem; margin:0 0 .35rem; }
      .lede { color:var(--dim); margin:0 0 1.75rem; max-width:62ch; }
      .row { display:grid; grid-template-columns: 260px 1fr; gap:1.5rem; align-items:start;
             background:var(--panel); border:1px solid var(--line); border-radius:14px;
             padding:1.25rem; margin-bottom:1.25rem; }
      .row__art img { width:100%; border-radius:10px; display:block; cursor:grab; background:#000; }
      .download { display:inline-block; margin-top:.6rem; font-size:.82rem; color:var(--dim); }
      .row__head { display:flex; align-items:baseline; gap:.75rem; flex-wrap:wrap; margin-bottom:.35rem; }
      .row__head h2 { font-size:1.15rem; margin:0; }
      .row__meta { color:var(--dim); font-size:.8rem; }
      .badge { margin-left:auto; font-size:.72rem; letter-spacing:.06em; text-transform:uppercase;
               border:1px solid var(--line); border-radius:999px; padding:.15rem .6rem; color:var(--dim); }
      .badge.is-done { color:var(--ok); border-color:var(--ok); }
      .hint { color:var(--dim); font-size:.82rem; margin:.1rem 0 .7rem; }
      .services { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1rem; }
      .service { border:1px solid var(--line); border-radius:8px; padding:.4rem .8rem;
                 font-size:.86rem; text-decoration:none; color:var(--ink); background:#23232f; }
      .service:hover { border-color:var(--ok); }
      .fields { display:grid; gap:.7rem; }
      label { display:grid; gap:.25rem; font-size:.8rem; color:var(--dim); }
      input { font:inherit; font-size:.9rem; color:var(--ink); background:#15151f;
              border:1px solid var(--line); border-radius:8px; padding:.5rem .65rem; }
      input:focus { outline:none; border-color:var(--ok); }
      input.is-bad { border-color:#e07e7e; }
      .bar { position:fixed; left:0; right:0; bottom:0; background:#0d0d14; border-top:1px solid var(--line);
             padding:.9rem 1.5rem; display:flex; gap:1rem; align-items:center; justify-content:center; }
      button { font:inherit; font-size:.9rem; background:var(--ok); color:#0d0d14; border:0;
               border-radius:8px; padding:.55rem 1.1rem; cursor:pointer; font-weight:600; }
      button.quiet { background:#23232f; color:var(--ink); border:1px solid var(--line); font-weight:400; }
      .count { color:var(--dim); font-size:.86rem; }
      dialog { background:var(--panel); color:var(--ink); border:1px solid var(--line);
               border-radius:12px; padding:1.25rem; max-width:min(860px, 92vw); }
      dialog textarea { width:100%; height:52vh; font:13px/1.5 ui-monospace, monospace; color:var(--ink);
                        background:#15151f; border:1px solid var(--line); border-radius:8px; padding:.75rem; }
      @media (max-width: 760px) { .row { grid-template-columns: 1fr; } }`;

const pageScript = (meta, order) => `
      ${mergeCredits.toString()}
      ${isUsableSourceUrl.toString()}
      ${stringifyMeta.toString()}

      const META = ${JSON.stringify(meta)};
      const META_ORDER = ${JSON.stringify(order)};
      const KEY = 'aoab-provenance';
      const rows = [...document.querySelectorAll('[data-row]')];

      const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
      let answers = load();

      const sync = () => {
        let done = 0;
        for (const row of rows) {
          const id = row.dataset.id;
          const answer = answers[id] || {};
          const traced = (answer.artist || '').trim() !== '';
          if (traced) done += 1;
          row.querySelector('[data-badge]').textContent = traced ? 'traced' : 'untraced';
          row.querySelector('[data-badge]').classList.toggle('is-done', traced);
          const url = row.querySelector('[data-field="url"]');
          const bad = url.value.trim() !== '' && !isUsableSourceUrl(url.value);
          url.classList.toggle('is-bad', bad);
        }
        document.querySelector('[data-count]').textContent = done + ' of ' + rows.length + ' traced';
        try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch {}
      };

      for (const row of rows) {
        const id = row.dataset.id;
        for (const input of row.querySelectorAll('[data-field]')) {
          const field = input.dataset.field;
          input.value = (answers[id] && answers[id][field]) || '';
          input.addEventListener('input', () => {
            answers[id] = { ...(answers[id] || {}), [field]: input.value };
            sync();
          });
        }
      }

      document.querySelector('[data-emit]').addEventListener('click', () => {
        const merged = mergeCredits(META, answers);
        const text = stringifyMeta(merged, META_ORDER);
        const dialog = document.querySelector('dialog');
        dialog.querySelector('textarea').value = text;
        dialog.showModal();
        navigator.clipboard && navigator.clipboard.writeText(text).catch(() => {});
      });

      document.querySelector('[data-close]').addEventListener('click', () => {
        document.querySelector('dialog').close();
      });

      document.querySelector('[data-reset]').addEventListener('click', () => {
        if (!confirm('Clear every answer on this sheet?')) return;
        answers = {};
        for (const input of document.querySelectorAll('[data-field]')) input.value = '';
        sync();
      });

      sync();`;

/**
 * @param {Array<{id:string,title:string,file:string,width:number,height:number,dataUri:string}>} images
 * @param {Record<string, unknown>} meta Parsed gallery.meta.json, used as the merge base.
 * @param {string[]} order Top-level key order from the raw file, so the emitted
 *   JSON comes back in the curated order rather than JavaScript's.
 * @returns {string} A self-contained HTML document.
 */
export function buildSheetHtml(images, meta, order = Object.keys(meta)) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Artwork provenance</title>
    <style>${STYLE}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Artwork provenance</h1>
      <p class="lede">
        One row per source image. Drag the artwork straight into a search box, or save it and
        upload. Fill in what you find; the sheet remembers your answers in this browser. When you
        are done, <strong>Copy gallery.meta.json</strong> gives you the whole file, credits merged
        in, ready to paste over <code>src/data/gallery.meta.json</code>.
      </p>
${images.map(row).join('\n')}
    </div>

    <div class="bar">
      <span class="count" data-count></span>
      <button type="button" data-emit>Copy gallery.meta.json</button>
      <button type="button" class="quiet" data-reset>Clear</button>
    </div>

    <dialog>
      <textarea readonly></textarea>
      <p><button type="button" class="quiet" data-close>Close</button> Copied to your clipboard. Paste it over <code>src/data/gallery.meta.json</code>.</p>
    </dialog>

    <script>${pageScript(meta, order)}
    </script>
  </body>
</html>
`;
}
