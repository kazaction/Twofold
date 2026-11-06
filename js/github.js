// Minimal GitHub client using the Git Data API.
// Every push creates ONE commit containing all new files. Files are only ever added,
// never modified, so two devices pushing at the same time can never conflict: if the
// branch moved, we just rebuild the commit on top of the new head and retry.

import { toB64, fromB64 } from './crypto.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

export class GitHub {
  constructor({ repo, branch, token }) {
    this.repo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    this.branch = (branch || 'main').trim();
    this.token = token.trim();
  }

  async api(path, { method = 'GET', body } = {}) {
    let r;
    try {
      r = await fetch(`${API}/repos/${this.repo}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, 'Network error – are you offline?');
    }
    if (!r.ok) {
      let detail = null;
      try { detail = await r.json(); } catch {}
      const msg = {
        401: 'GitHub rejected the token (expired or wrong?)',
        403: detail?.message?.includes('rate limit') ? 'GitHub rate limit reached, try again later' : 'Token lacks permission for this repo',
        404: 'Not found (check repo name and token access)',
      }[r.status] || detail?.message || `GitHub error ${r.status}`;
      throw new GitHubError(r.status, msg, detail);
    }
    return r.status === 204 ? null : r.json();
  }

  repoInfo() { return this.api(''); }

  async headCommit() {
    try {
      const ref = await this.api(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
      return ref.object.sha;
    } catch (e) {
      if (e.status === 404 || e.status === 409) return null; // branch missing or repo empty
      throw e;
    }
  }

  // Empty repos have no commits; the Git Data API refuses to work until one exists.
  async ensureInitialized() {
    if (await this.headCommit()) return;
    await this.api('/contents/README.md', {
      method: 'PUT',
      body: {
        message: 'init',
        branch: this.branch,
        content: toB64(new TextEncoder().encode('# Encrypted vault\n\nEverything here is end-to-end encrypted and unreadable without the key.\n')),
      },
    }).catch(async (e) => {
      // If the branch param fails on a truly empty repo, retry without it.
      if (e.status === 404 || e.status === 422) {
        await this.api('/contents/README.md', { method: 'PUT', body: { message: 'init', content: toB64(new TextEncoder().encode('# Encrypted vault\n')) } });
      } else throw e;
    });
    if (!(await this.headCommit())) throw new GitHubError(0, `Branch "${this.branch}" does not exist in the repo`);
  }

  // Returns { head, files: Map(path -> sha) } for the whole branch.
  async listFiles() {
    const head = await this.headCommit();
    if (!head) return { head: null, files: new Map() };
    const commit = await this.api(`/git/commits/${head}`);
    const tree = await this.api(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) console.warn('Tree listing truncated – repo very large');
    const files = new Map();
    for (const t of tree.tree) if (t.type === 'blob') files.set(t.path, t.sha);
    return { head, files };
  }

  async getBlob(sha) {
    const b = await this.api(`/git/blobs/${sha}`);
    return fromB64(b.content);
  }

  async createBlob(bytes) {
    const b = await this.api('/git/blobs', { method: 'POST', body: { content: toB64(bytes), encoding: 'base64' } });
    return b.sha;
  }

  // files: [{ path, bytes }] -> returns { commit, shas: Map(path -> blob sha) }
  async commitFiles(files, message = 'sync', onProgress) {
    await this.ensureInitialized();
    const entries = [];
    const shas = new Map();
    let i = 0;
    for (const f of files) {
      const sha = await this.createBlob(f.bytes);
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha });
      shas.set(f.path, sha);
      onProgress?.(++i, files.length);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const head = await this.headCommit();
      const parent = await this.api(`/git/commits/${head}`);
      const tree = await this.api('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree: entries } });
      const commit = await this.api('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head] } });
      try {
        await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        return { commit: commit.sha, shas };
      } catch (e) {
        if (e.status === 422 || e.status === 409) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
        throw e;
      }
    }
    throw new GitHubError(0, 'Could not push after several retries – try again');
  }
}
