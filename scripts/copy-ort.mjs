// Self-host the onnxruntime-web WASM that transformers.js would otherwise pull from jsDelivr,
// so rendering works offline and under COEP.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const src = 'node_modules/@huggingface/transformers/dist';
const dest = 'public/ort';
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.startsWith('ort-wasm')) cpSync(`${src}/${f}`, `${dest}/${f}`);
}
