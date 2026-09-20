#!/usr/bin/env node
/**
 * Builds the provenance sheet from whatever is currently in the repo.
 *
 * Reads the *source* images rather than the generated ones on purpose: the
 * pipeline upscales art 4x, and a reverse-image search against an upscaled
 * copy matches worse than one against the file as it was downloaded.
 *
 *   node scripts/provenance/build-sheet.mjs [outfile]
 *
 * The output is a working document, not a build artifact, so it defaults to a
 * temp path and is never written into the repo.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { buildSheetHtml, topLevelKeys } from './sheet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function main() {
  const out = process.argv[2] ?? path.join(os.tmpdir(), 'aoab-provenance', 'sheet.html');

  const metaText = await readFile(path.join(root, 'src/data/gallery.meta.json'), 'utf8');
  const meta = JSON.parse(metaText);
  // Read from the text, not the parsed object, which has already lost it.
  const order = topLevelKeys(metaText);

  const sourceDir = path.join(root, 'src/assets/source');
  const files = (await readdir(sourceDir)).filter((file) => MIME[path.extname(file).toLowerCase()]);

  // The hero is in the sequence too, and needs crediting just as much as the
  // ten gallery pieces, so this walks the directory rather than the manifest's
  // gallery ordering.
  files.sort();

  const images = await Promise.all(
    files.map(async (file) => {
      const id = path.basename(file, path.extname(file));
      const bytes = await readFile(path.join(sourceDir, file));
      // Measured from the file, not read off the manifest: the manifest records
      // the upscaled size, and the sheet has to show what the search engines
      // will actually receive.
      const { width = 0, height = 0 } = await sharp(bytes).metadata();
      return {
        id,
        file,
        title: meta[id]?.title ?? id,
        width,
        height,
        dataUri: `data:${MIME[path.extname(file).toLowerCase()]};base64,${bytes.toString('base64')}`,
      };
    }),
  );

  // The default lands in a directory that does not exist yet, and a path the
  // caller passed may not either.
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, buildSheetHtml(images, meta, order), 'utf8');
  console.log(`${images.length} images -> ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
