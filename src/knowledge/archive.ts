/**
 * Read Splunk app/TA packages (.tgz / .spl / .tar.gz / .tar) in the browser and
 * return the knowledge files they contain. Uses pako for gzip; the tar reader
 * is a minimal ustar/GNU implementation (long names supported).
 */
import { ungzip } from 'pako';

export interface ArchiveFile {
  path: string;
  text: string;
}

const WANTED = new Set(['props.conf', 'transforms.conf', 'eventtypes.conf', 'tags.conf', 'macros.conf']);

function isWanted(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (WANTED.has(base) && /\/(default|local)\//.test('/' + path)) return true;
  if (path.includes('/data/models/') && path.endsWith('.json')) return true;
  if (path.includes('/lookups/') && path.endsWith('.csv')) return true;
  return false;
}

function octal(bytes: Uint8Array): number {
  let s = '';
  for (const b of bytes) {
    if (b === 0 || b === 32) break;
    s += String.fromCharCode(b);
  }
  return s ? parseInt(s, 8) : 0;
}

function str(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** Parse a tar byte stream, returning only the files the knowledge loader cares about. */
export function readTar(buf: Uint8Array): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  let pos = 0;
  let longName: string | null = null;
  const decoder = new TextDecoder();
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    let name = str(header.subarray(0, 100));
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156]);
    const magic = str(header.subarray(257, 263));
    const prefix = magic.startsWith('ustar') ? str(header.subarray(345, 500)) : '';
    if (prefix) name = prefix + '/' + name;
    if (longName) {
      name = longName;
      longName = null;
    }
    const dataStart = pos + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    if (type === 'L') {
      longName = str(data);
    } else if ((type === '0' || type === '\0' || type === '') && isWanted(name)) {
      // CSV lookups: only the name matters (contents are not needed for translation).
      out.push({ path: '/' + name.replace(/^\.\//, ''), text: name.endsWith('.csv') ? '' : decoder.decode(data) });
    }
    pos = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Read a .tgz/.spl/.tar.gz/.tar file's knowledge files. */
export async function readArchive(file: File): Promise<ArchiveFile[]> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const tar = isGzip(raw) ? ungzip(raw) : raw;
  return readTar(tar);
}
