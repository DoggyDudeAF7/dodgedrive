import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error('The game module was not found in index.html');

const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], {
  input: match[1],
  encoding: 'utf8'
});
if (checked.status !== 0) {
  process.stderr.write(checked.stderr || checked.stdout);
  process.exit(checked.status || 1);
}

const requiredFiles = [
  '../vendor/three.module.js',
  '../vendor/GLTFLoader.js',
  '../vendor/OBJLoader.js',
  '../vendor/MTLLoader.js',
  '../vendor/USDLoader.js',
  '../assets/vehicles/player-car.glb'
];
for (const file of requiredFiles) await readFile(new URL(file, import.meta.url));
console.log('DodgeDrive validation passed.');

