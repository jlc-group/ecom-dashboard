const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distIndex = path.join(distDir, 'index.html');
const distAssets = path.join(distDir, 'assets');
const rootIndex = path.join(rootDir, 'index.html');
const rootAssets = path.join(rootDir, 'assets');

if (!fs.existsSync(distIndex)) {
  throw new Error('dist/index.html not found');
}

fs.copyFileSync(distIndex, rootIndex);

if (fs.existsSync(distAssets)) {
  fs.cpSync(distAssets, rootAssets, { recursive: true, force: true });
}

console.log('Copied build output to project root');
