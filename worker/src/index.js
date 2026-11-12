/**
 * Category-save API for crayon-ai/my-cover-library.
 * Secrets (SAVE_PASSWORD, GITHUB_TOKEN) are bound at deploy time; never log them.
 */

const REPO = "crayon-ai/my-cover-library";
const BRANCH = "main";
const SITE_ORIGIN = "https://crayon-ai.github.io";
const GENERIC_ERROR = "保存失败";
const MAX_MOVES = 50;
const MAX_NAME = 20;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error("worker_error", err && err.name);
      return json(500, { ok: false, error: GENERIC_ERROR }, request);
    }
  },
};

async function handle(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json(200, { ok: true }, request);
  }

  if (request.method === "POST" && url.pathname === "/move") {
    if (origin && !isAllowedOrigin(origin)) {
      return json(403, { ok: false, error: GENERIC_ERROR }, request);
    }
    return await handleMove(request, env);
  }

  return json(404, { ok: false, error: GENERIC_ERROR }, request);
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === SITE_ORIGIN) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : SITE_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, body, request) {
  const origin = (request && request.headers.get("Origin")) || "";
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(origin),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleMove(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: GENERIC_ERROR }, request);
  }

  const submitted = payload && typeof payload.password === "string" ? payload.password : "";
  if (!(await verifyPassword(submitted, env.SAVE_PASSWORD))) {
    return json(401, { ok: false, error: GENERIC_ERROR }, request);
  }
  if (!env.GITHUB_TOKEN) {
    return json(401, { ok: false, error: GENERIC_ERROR }, request);
  }

  const parsed = parseMoves(payload);
  if (!parsed.ok) {
    return json(400, { ok: false, error: GENERIC_ERROR }, request);
  }

  const result = await commitMoves(env.GITHUB_TOKEN, parsed.moves, parsed.createCategories, 0);
  if (!result.ok) {
    return json(result.status || 500, { ok: false, error: GENERIC_ERROR }, request);
  }
  return json(200, result.body, request);
}

async function verifyPassword(input, secret) {
  const enc = new TextEncoder();
  const a = typeof input === "string" ? input : "";
  const b = typeof secret === "string" ? secret : "";
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const xa = new Uint8Array(ha);
  const xb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ xb[i];
  if (!a || !b) return false;
  return diff === 0;
}

function parseMoves(payload) {
  if (!payload || typeof payload !== "object") return { ok: false };
  const createCategories = new Set();

  const addCreate = (name) => {
    const n = normalizeCategory(name);
    if (!n) return false;
    createCategories.add(n);
    return true;
  };

  if (payload.createCategory === true && typeof payload.category === "string") {
    if (!addCreate(payload.category)) return { ok: false };
  }
  if (Array.isArray(payload.createCategories)) {
    for (const name of payload.createCategories) {
      if (!addCreate(name)) return { ok: false };
    }
  }

  let moves = [];
  if (Array.isArray(payload.moves)) {
    for (const m of payload.moves) {
      if (!m || typeof m.id !== "string" || typeof m.category !== "string") return { ok: false };
      const id = m.id.trim();
      const category = normalizeCategory(m.category);
      if (!isCoverId(id) || !category) return { ok: false };
      moves.push({ id, category });
    }
  } else if (Array.isArray(payload.ids) && typeof payload.category === "string") {
    const category = normalizeCategory(payload.category);
    if (!category) return { ok: false };
    for (const raw of payload.ids) {
      if (typeof raw !== "string") return { ok: false };
      const id = raw.trim();
      if (!isCoverId(id)) return { ok: false };
      moves.push({ id, category });
    }
  } else {
    return { ok: false };
  }

  if (!moves.length || moves.length > MAX_MOVES) return { ok: false };
  // de-dupe ids, last category wins
  const byId = new Map();
  for (const m of moves) byId.set(m.id, m.category);
  moves = Array.from(byId, ([id, category]) => ({ id, category }));
  return { ok: true, moves, createCategories: Array.from(createCategories) };
}

function isCoverId(id) {
  return /^c\d+$/.test(id);
}

function normalizeCategory(name) {
  if (typeof name !== "string") return "";
  const n = name.trim();
  if (!n || n.length > MAX_NAME) return "";
  if (n === "全部") return "";
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) return "";
  return n;
}

function safeName(s, maxlen) {
  const cleaned = String(s)
    .replace(/[\\/:*?"<>|#%&{}$!'@`=+\s]+/g, "")
    .replace(/^\.+|\.+$/g, "");
  return (cleaned.slice(0, maxlen || 40) || "cover");
}

function uniquePath(rel, used) {
  if (!used.has(rel)) return rel;
  const dot = rel.lastIndexOf(".");
  const base = dot >= 0 ? rel.slice(0, dot) : rel;
  const ext = dot >= 0 ? rel.slice(dot) : "";
  let i = 2;
  let next = `${base}-${i}${ext}`;
  while (used.has(next)) {
    i += 1;
    next = `${base}-${i}${ext}`;
  }
  return next;
}

function nowShanghai() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

async function github(token, path, opts) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "my-cover-library-api",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts && opts.body && !opts.rawBody) {
    headers["Content-Type"] = "application/json";
  }
  if (opts && opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(`https://api.github.com${path}`, {
    method: (opts && opts.method) || "GET",
    headers,
    body: opts && opts.body ? (opts.rawBody ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  return res;
}


async function readCatalogText(res) {
  const text = await res.text();
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("application/json") && !ctype.includes("raw")) {
    const body = JSON.parse(text);
    if (body && typeof body.content === "string") return decodeBase64Utf8(body.content);
  }
  return text;
}

function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function commitMoves(token, moves, createCategories, attempt) {
  const refRes = await github(token, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  if (!refRes.ok) return { ok: false, status: 500 };
  const ref = await refRes.json();
  const commitSha = ref.object && ref.object.sha;
  if (!commitSha) return { ok: false, status: 500 };

  const commitRes = await github(token, `/repos/${REPO}/git/commits/${commitSha}`);
  if (!commitRes.ok) return { ok: false, status: 500 };
  const commit = await commitRes.json();
  const baseTreeSha = commit.tree && commit.tree.sha;
  if (!baseTreeSha) return { ok: false, status: 500 };

  const treeRes = await github(token, `/repos/${REPO}/git/trees/${baseTreeSha}?recursive=1`);
  if (!treeRes.ok) return { ok: false, status: 500 };
  const treeData = await treeRes.json();
  if (treeData.truncated) return { ok: false, status: 500 };

  const blobs = new Map();
  for (const item of treeData.tree || []) {
    if (item.type === "blob") blobs.set(item.path, item);
  }
  const catalogEntry = blobs.get("catalog.json");
  if (!catalogEntry) return { ok: false, status: 500 };

  const catalogRes = await github(token, `/repos/${REPO}/contents/catalog.json?ref=${encodeURIComponent(commitSha)}`, {
    headers: { Accept: "application/vnd.github.raw" },
  });
  if (!catalogRes.ok) return { ok: false, status: 500 };
  // catalog.json is a small, bounded index
  const catalog = JSON.parse(await readCatalogText(catalogRes));
  if (!catalog || !Array.isArray(catalog.covers) || !Array.isArray(catalog.categories)) {
    return { ok: false, status: 500 };
  }

  const catIds = new Set(catalog.categories.map((c) => c.id));
  const created = [];
  for (const name of createCategories) {
    if (!catIds.has(name)) {
      catalog.categories.push({ id: name, name });
      catIds.add(name);
      created.push(name);
    }
  }

  const usedPaths = new Set(blobs.keys());
  const treeEdits = [];
  const moved = [];
  const coversById = new Map(catalog.covers.map((c) => [c.id, c]));

  for (const { id, category } of moves) {
    const cover = coversById.get(id);
    if (!cover) return { ok: false, status: 400 };
    if (!catIds.has(category)) return { ok: false, status: 400 };
    if (cover.category === category) continue;

    const from = cover.category;
    const oldPath = cover.path;
    const blob = blobs.get(oldPath);
    if (!blob || !blob.sha) return { ok: false, status: 500 };

    const baseName = oldPath.split("/").pop();
    const folder = `covers/${safeName(category)}`;
    const dest = uniquePath(`${folder}/${baseName}`, usedPaths);
    usedPaths.delete(oldPath);
    usedPaths.add(dest);

    treeEdits.push({ path: dest, mode: "100644", type: "blob", sha: blob.sha });
    treeEdits.push({ path: oldPath, mode: "100644", type: "blob", sha: null });

    cover.category = category;
    cover.path = dest;
    moved.push({ id, from, to: category, path: dest });
  }

  if (!moved.length && !created.length) {
    return {
      ok: true,
      body: { ok: true, commit: commitSha, moved: [], createdCategory: null, unchanged: true },
    };
  }

  catalog.updatedAt = nowShanghai();
  const catalogJson = JSON.stringify(catalog, null, 2) + "\n";
  treeEdits.push({ path: "catalog.json", mode: "100644", type: "blob", content: catalogJson });

  const newTreeRes = await github(token, `/repos/${REPO}/git/trees`, {
    method: "POST",
    body: { base_tree: baseTreeSha, tree: treeEdits },
  });
  if (!newTreeRes.ok) return { ok: false, status: 500 };
  const newTree = await newTreeRes.json();

  const message = commitMessage(moved, created);
  const newCommitRes = await github(token, `/repos/${REPO}/git/commits`, {
    method: "POST",
    body: {
      message,
      tree: newTree.sha,
      parents: [commitSha],
    },
  });
  if (!newCommitRes.ok) return { ok: false, status: 500 };
  const newCommit = await newCommitRes.json();

  const updateRes = await github(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: { sha: newCommit.sha, force: false },
  });
  if (!updateRes.ok) {
    // Non-fast-forward: one retry from latest tip
    if (updateRes.status === 422 && (attempt || 0) < 1) {
      return commitMoves(token, moves, createCategories, 1);
    }
    return { ok: false, status: 500 };
  }

  return {
    ok: true,
    body: {
      ok: true,
      commit: newCommit.sha,
      moved,
      createdCategory: created.length === 1 ? created[0] : created.length ? created : null,
    },
  };
}

function commitMessage(moved, created) {
  const bits = [];
  if (created.length) bits.push("add category " + created.join(", "));
  if (moved.length === 1) bits.push(`move ${moved[0].id} to ${moved[0].to}`);
  else if (moved.length) {
    const dests = Array.from(new Set(moved.map((m) => m.to)));
    if (dests.length === 1) bits.push(`move ${moved.length} covers to ${dests[0]}`);
    else bits.push(`move ${moved.length} covers`);
  }
  return bits.join("; ") || "update cover categories";
}
