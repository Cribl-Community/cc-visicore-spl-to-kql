/**
 * Backend endpoint: import Splunk knowledge from an app/TA package at a URL.
 *
 *   POST /api/v1/a/<appId>/endpoints/importUrl
 *   { "url": "https://github.com/splunk/addonfactory-splunk_sa_cim/archive/refs/heads/master.tar.gz", "replace": false }
 *
 * The host must be declared in config/proxies.yml (GitHub hosts are). The
 * archive is unpacked server-side, so large packages never touch the browser.
 */
import { ungzip } from 'pako';
import { readTar } from '../src/knowledge/archive.js';
import { knowledgeFromFiles } from '../src/knowledge/conf.js';
import { errorResponse, json } from './lib/kv.js';
import { storeSharedKnowledge } from './lib/merge.js';

const MAX_BYTES = 60 * 1024 * 1024;

/**
 * GitHub archive links (`github.com/<owner>/<repo>/archive/...tar.gz`) redirect to
 * codeload.github.com; fetch codeload directly so the download does not depend on
 * redirect handling in the platform proxy.
 */
/** Human-readable source label: `owner/repo@ref` for GitHub archives, else the file name. */
export function archiveLabel(url: string): string {
  const gh = url.match(/^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/tar\.gz\/(?:refs\/(?:heads|tags)\/)?(.+)$/i);
  if (gh) return `${gh[1]}/${gh[2]}@${gh[3]}`;
  return decodeURIComponent(url.split('/').filter(Boolean).pop() ?? url).slice(0, 120);
}

export function normalizeArchiveUrl(url: string): string {
  const m = url.match(/^https:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/archive\/(.+?)\.(tar\.gz|tgz)$/i);
  if (!m) return url;
  const [, owner, repo, ref] = m;
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
}

export async function onRequest(request: Request, context: { appId: string; invocationId?: string }): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ ok: false, error: 'POST a JSON body: { url, replace? }' }, 405);
    const body = (await request.json().catch(() => ({}))) as { url?: string; replace?: boolean };
    const url = (body.url ?? '').trim();
    if (!/^https:\/\//i.test(url)) return json({ ok: false, error: 'url must be an https:// link to a .tgz/.spl/.tar.gz package' }, 400);

    const target = normalizeArchiveUrl(url);
    console.log(`[importUrl] ${context.appId} fetching ${target}`);
    const res = await fetch(target, { redirect: 'follow' });
    if (!res.ok) return json({ ok: false, error: `Download failed: HTTP ${res.status}` }, 502);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return json({ ok: false, error: `Package is larger than ${MAX_BYTES / 1024 / 1024} MB` }, 413);

    const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const files = readTar(isGzip ? ungzip(buf) : buf);
    if (!files.length) return json({ ok: false, error: 'No props/transforms/eventtypes/tags/macros or data model files found in the archive.' }, 422);

    const label = archiveLabel(target);
    const k = knowledgeFromFiles(files, label);
    const status = await storeSharedKnowledge(k, label, !!body.replace);
    return json({ ok: true, files: files.length, loaded: k.sources, status });
  } catch (e) {
    return errorResponse(e);
  }
}
