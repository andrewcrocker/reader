// OPFS-backed stand-in for the Cache API, used for the TTS model files.
// Chrome rejects single Cache API entries above roughly 10% of quota, which the
// 325 MB fp32 model can exceed; OPFS has no such per-file limit, and
// createWritable() commits atomically, so an interrupted download leaves nothing behind.

export interface ModelCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

const fileName = (key: string) => key.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');

async function modelsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}

export function opfsWritable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

export const opfsCache: ModelCache = {
  async match(key) {
    try {
      const file = await (await (await modelsDir()).getFileHandle(fileName(key))).getFile();
      if (file.size === 0) return undefined;
      return new Response(file, {
        headers: { 'Content-Length': String(file.size), 'Content-Type': 'application/octet-stream' },
      });
    } catch {
      return undefined;
    }
  },
  async put(key, res) {
    const dir = await modelsDir();
    const handle = await dir.getFileHandle(fileName(key), { create: true });
    const writable = await handle.createWritable();
    try {
      if (res.body) await res.body.pipeTo(writable);
      else {
        await writable.write(await res.arrayBuffer());
        await writable.close();
      }
    } catch (err) {
      await writable.abort().catch(() => {});
      await dir.removeEntry(fileName(key)).catch(() => {});
      throw err;
    }
  },
};

export const browserCache: ModelCache = {
  async match(key) {
    return (await caches.open('transformers-cache')).match(key);
  },
  async put(key, res) {
    await (await caches.open('transformers-cache')).put(key, res);
  },
};
