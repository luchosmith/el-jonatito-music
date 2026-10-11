// Bundles the React app with esbuild into web/dist. Usage: node scripts/build-web.mjs [--watch]
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');
const watch = process.argv.includes('--watch');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
for (const f of ['manifest.webmanifest', 'icon.svg']) {
  fs.copyFileSync(path.join(web, 'public', f), path.join(dist, f));
}

const options = {
  entryPoints: [path.join(web, 'src', 'main.tsx')],
  bundle: true,
  outdir: path.join(dist, 'assets'),
  // A new name for every build (app-<hash>.js), so Cloudflare and browsers never keep an old copy.
  // Watch mode keeps plain names; index.html is written once.
  entryNames: watch ? 'app' : 'app-[hash]',
  metafile: true,
  format: 'esm',
  jsx: 'automatic',
  target: ['es2022', 'chrome110', 'safari16'],
  sourcemap: true,
  minify: !watch,
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

/** Points index.html at the built files (served with no-cache, so it always names the newest build). */
function writeIndex(metafile) {
  const outs = Object.keys(metafile.outputs).map((f) => path.basename(f));
  const js = outs.find((f) => f.endsWith('.js'));
  const css = outs.find((f) => f.endsWith('.css'));
  const html = fs
    .readFileSync(path.join(web, 'public', 'index.html'), 'utf8')
    .replace('/assets/app.js', `/assets/${js}`)
    .replace('/assets/app.css', `/assets/${css}`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);
}

if (watch) {
  const ctx = await esbuild.context(options);
  writeIndex((await ctx.rebuild()).metafile);
  await ctx.watch();
  console.log('Watching web/src for changes...');
} else {
  writeIndex((await esbuild.build(options)).metafile);
}
