import { db } from '../db';

// Audio lives in OPFS when the browser supports writable file handles, else in IndexedDB.
// Keys are prefixed with the backend so either can be read back later.

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    if (typeof FileSystemFileHandle === 'undefined' || !('createWritable' in FileSystemFileHandle.prototype)) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('audio', { create: true });
  } catch {
    return null;
  }
}

export async function saveAudio(id: string, blob: Blob, ext: string): Promise<string> {
  const dir = await opfsDir();
  if (dir) {
    const name = `${id}.${ext}`;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return `opfs:${name}`;
  }
  const key = `idb:${id}`;
  await db.audio.put({ key, blob });
  return key;
}

export async function loadAudio(key: string): Promise<Blob | null> {
  if (key.startsWith('opfs:')) {
    const dir = await opfsDir();
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle(key.slice(5));
      return await fh.getFile();
    } catch {
      return null;
    }
  }
  return (await db.audio.get(key))?.blob ?? null;
}

export async function deleteAudio(key: string): Promise<void> {
  if (key.startsWith('opfs:')) {
    const dir = await opfsDir();
    await dir?.removeEntry(key.slice(5)).catch(() => {});
  } else {
    await db.audio.delete(key);
  }
}

export async function audioBackend(): Promise<'opfs' | 'indexeddb'> {
  return (await opfsDir()) ? 'opfs' : 'indexeddb';
}
