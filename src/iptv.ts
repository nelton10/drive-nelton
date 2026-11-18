// M3U IPTV integration for DriveFlin. Existing Google Drive libraries remain unchanged.
// No transcoding is performed. Use only streams you are permitted to access.
import type { Hono } from "hono";

type Channel = { name: string; group: string; logo: string; streamUrl: string };

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch] || ch));
}

// Blocking literal private/loopback IPs and non-public hostnames prevents obvious SSRF.
// Operators should additionally use provider allowlists if enabling untrusted admin users.
function safeRemoteUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
        h.endsWith(".internal") || h.endsWith(".test") || h.endsWith(".invalid") ||
        h.includes(":") || /^\d+$/.test(h)) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const p = h.split(".").map(Number);
      if (p.some((n) => n < 0 || n > 255) || p[0] === 0 || p[0] === 10 ||
        p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
        (p[0] === 192 && p[1] === 0) ||
        (p[0] === 198 && (p[1] === 18 || p[1] === 19))) return null;
    }
    return u;
  } catch { return null; }
}

export function parseM3u(body: string): Channel[] {
  const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.some((line) => line.trim().startsWith("#EXTM3U"))) throw new Error("A lista precisa começar com #EXTM3U.");
  const result: Channel[] = [];
  let pending: Omit<Channel, "streamUrl"> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const props = (key: string) => {
        const match = line.match(new RegExp(key + '="([^"]*)"', "i"));
        return match ? match[1].trim() : "";
      };
      pending = {
        name: (line.includes(",") ? line.slice(line.indexOf(",") + 1).trim() : "") || props("tvg-name") || "Canal",
        group: props("group-title") || "Outros",
        logo: safeRemoteUrl(props("tvg-logo"))?.toString() || "",
      };
    } else if (line && !line.startsWith("#") && pending) {
      const url = safeRemoteUrl(line);
      if (url) result.push({ ...pending, streamUrl: url.toString() });
      pending = null;
    }
    if (result.length >= 1500) break;
  }
  return result;
}

async function ensureIptv(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS IptvSources (
    Id TEXT PRIMARY KEY, Name TEXT NOT NULL, SourceUrl TEXT,
    UpdatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS IptvChannels (
    Id TEXT PRIMARY KEY, SourceId TEXT NOT NULL, Name TEXT NOT NULL,
    Category TEXT NOT NULL, Logo TEXT, StreamUrl TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_iptv_source ON IptvChannels(SourceId)").run();
}

const shell = (body: string) => `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>DriveFlin • IPTV</title>
<style>
:root{color-scheme:dark}body{font:16px system-ui;background:#111217;color:#f6f6fa;max-width:1050px;margin:auto;padding:24px}
h1{font-size:1.9rem}a{color:#9ac7ff}form,.panel{border:1px solid #303340;border-radius:12px;padding:16px;margin:15px 0;background:#1b1d26}
input,textarea,button{font:inherit;color:inherit;border-radius:8px;padding:10px;margin:4px 0}
input,textarea{background:#101118;border:1px solid #555;box-sizing:border-box;width:100%}
button{background:#345ef1;color:white;border:0;cursor:pointer}
label{display:block;margin-top:10px}small{color:#b9bdcb}table{width:100%;border-collapse:collapse}
td,th{padding:10px;text-align:left;border-bottom:1px solid #343844}
</style></head><body><h1>📺 DriveFlin IPTV</h1>
<p><a href="/web/index.html">← Voltar ao Jellyfin</a> · <a href="/api/iptv/channels">API de canais</a></p>
${body}</body></html>`;

async function readLimitedText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12000),
    headers: { Accept: "audio/x-mpegurl, application/vnd.apple.mpegurl, text/plain" } });
  if (!response.ok) throw new Error("Falha ao carregar a lista do provedor (HTTP " + response.status + ").");
  if (Number(response.headers.get("content-length") || 0) > 2_000_000) throw new Error("Lista acima do limite de 2 MB.");
  if (!response.body) throw new Error("Resposta vazia do provedor.");
  const reader = response.body.getReader();
  let size = 0; const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error("Lista acima do limite de 2 MB.");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const data = new Uint8Array(size); let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return new TextDecoder("utf-8").decode(data);
}


/** Lightweight Jellyfin-compatible Live TV channel DTOs, separate from Google Drive items. */
function asChannelDto(row: any, origin: string) {
  const id = String(row.Id);
  return {
    Name: row.Name, Id: id, ServerId: "driveflin-iptv", Type: "TvChannel",
    ChannelType: "TV", MediaType: "Video", IsFolder: false, IsLive: true,
    CanDelete: false, CanDownload: false, HasSubtitles: false,
    ImageTags: row.Logo ? { Primary: id } : {},
    PrimaryImageAspectRatio: 1.777,
    ChannelNumber: row.ChannelNumber || null,
    Etag: id, Path: origin + "/Videos/" + id + "/stream.ts",
    UserData: { IsFavorite: false, Played: false, PlaybackPositionTicks: 0 },
  };
}

export async function iptvPlaybackInfo(db: D1Database, id: string, token?: string) {
  if (!/^[0-9a-f]{32}$/i.test(id || "")) return null;
  await ensureIptv(db);
  const row = await db.prepare("SELECT Id, Name, StreamUrl FROM IptvChannels WHERE Id=?")
    .bind(id).first<{ Id: string; Name: string; StreamUrl: string }>();
  if (!row) return null;
  const ext = /\\.m3u8?(?:\\?|$)/i.test(row.StreamUrl) ? "hls" : "ts";
  const path = "/Videos/" + id + (ext === "hls" ? "/master.m3u8" : "/stream.ts");
  // Only add the current user's access token, never an IPTV-provider secret.
  const direct = path + (token ? "?api_key=" + encodeURIComponent(token) : "");
  return {
    PlaySessionId: id,
    MediaSources: [{
      Protocol: "Http", Id: id, Path: path, Name: row.Name,
      Type: "Default", Container: ext === "hls" ? "hls" : "ts",
      IsRemote: true, IsInfiniteStream: true, IsLive: true,
      SupportsDirectPlay: true, SupportsDirectStream: true, SupportsTranscoding: false,
      DirectStreamUrl: direct, MediaStreams: [],
      RequiredHttpHeaders: {},
    }],
  };
}

export async function iptvStreamRedirect(db: D1Database, id: string): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/i.test(id || "")) return null;
  await ensureIptv(db);
  const row = await db.prepare("SELECT StreamUrl FROM IptvChannels WHERE Id=?")
    .bind(id).first<{ StreamUrl: string }>();
  return row && safeRemoteUrl(row.StreamUrl)?.toString() || null;
}

export function registerIptvRoutes(app: Hono<any>) {

  // Native Jellyfin Live TV discovery. Register before the old /LiveTv/* fallback.
  app.get("/LiveTv/Info", async (c) => c.json({
    IsEnabled: true, Services: [{ Name: "DriveFlin IPTV", Status: "Ok" }],
    EnabledUsers: [], IsRecording: false, IsTimeshiftEnabled: false,
  }));
  app.get("/LiveTv/Channels", async (c) => {
    await ensureIptv(c.env.DB);
    const max = Math.min(500, Math.max(1, Number(c.req.query("limit") || 100)));
    const start = Math.max(0, Number(c.req.query("startIndex") || 0));
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM IptvChannels").first<{n: number}>();
    const channels = await c.env.DB.prepare(
      "SELECT Id,Name,Category,Logo FROM IptvChannels ORDER BY Category,Name LIMIT ? OFFSET ?"
    ).bind(max, start).all();
    return c.json({ Items: (channels.results || []).map((row: any) =>
      asChannelDto(row, new URL(c.req.url).origin)),
      TotalRecordCount: count?.n || 0, StartIndex: start });
  });
  app.get("/LiveTv/Channels/:id", async (c) => {
    await ensureIptv(c.env.DB);
    const row = await c.env.DB.prepare("SELECT Id,Name,Category,Logo FROM IptvChannels WHERE Id=?")
      .bind(c.req.param("id")).first();
    return row ? c.json(asChannelDto(row, new URL(c.req.url).origin)) : c.notFound();
  });
  app.get("/LiveTv/GuideInfo", (c) => c.json({ StartDate: new Date().toISOString(), EndDate: new Date().toISOString() }));
  app.get("/LiveTv/Programs", (c) => c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 }));
  app.get("/LiveTv/Tuners", (c) => c.json([]));
  // Native Jellyfin image route; the logo is public just like other item images.
  app.get("/LiveTv/Channels/:id/Images/Primary", async (c) => {
    await ensureIptv(c.env.DB);
    const row = await c.env.DB.prepare("SELECT Logo FROM IptvChannels WHERE Id=?")
      .bind(c.req.param("id")).first<{ Logo: string }>();
    const logo = row && safeRemoteUrl(row.Logo);
    return logo ? c.redirect(logo.toString(), 302) : c.notFound();
  });

  // Admin-only HTML management routes: access control is provided by classifyRoute().
  app.get("/iptv", async (c) => {
    await ensureIptv(c.env.DB);
    const sources = await c.env.DB.prepare(
      "SELECT Id, Name, UpdatedAt, (SELECT COUNT(*) FROM IptvChannels WHERE SourceId=IptvSources.Id) AS ChannelCount FROM IptvSources ORDER BY Name"
    ).all();
    const rows = ((sources.results || []) as any[]).map((s) =>
      `<tr><td>${escapeHtml(s.Name)}</td><td>${Number(s.ChannelCount) || 0}</td><td>
      <form method="post" action="/iptv/delete" style="margin:0;border:0;padding:0;background:none">
      <input type="hidden" name="id" value="${escapeHtml(s.Id)}"><button>Remover</button></form></td></tr>`
    ).join("");
    return c.html(shell(`<div class="panel"><p>Google Drive continua funcionando normalmente. Cadastre uma lista M3U para assistir à TV ao vivo.</p>
    <small>A reprodução é direta, sem transcodificação; depende do codec, CORS e permissões do provedor.</small></div>
    <form method="post" action="/iptv/import"><h2>Adicionar lista M3U</h2>
    <label>Nome<input name="name" maxlength="100" required placeholder="Minha lista IPTV"></label>
    <label>URL HTTP(S) da lista M3U (opcional)<input name="url" type="url" placeholder="https://provedor.example/lista.m3u"></label>
    <label>Ou cole o texto M3U<textarea name="m3u" rows="5" placeholder="#EXTM3U"></textarea></label>
    <button type="submit">Importar lista</button><p><small>Máximo de 1.500 canais e 2 MB por importação. Não publique URLs com senhas.</small></p></form>
    <div class="panel"><h2>Minhas listas</h2><table><tr><th>Nome</th><th>Canais</th><th>Ação</th></tr>
    ${rows || '<tr><td colspan="3">Nenhuma lista importada.</td></tr>'}</table></div>
    <p><a href="/iptv/watch">Abrir canais de TV</a></p>`));
  });

  app.post("/iptv/import", async (c) => {
    const form = await c.req.formData();
    const name = String(form.get("name") || "").trim().slice(0, 100);
    const urlRaw = String(form.get("url") || "").trim();
    const pasted = String(form.get("m3u") || "");
    if (!name || (!urlRaw && !pasted)) return c.text("Informe o nome e uma URL ou conteúdo M3U.", 400);
    if (pasted.length > 2_000_000) return c.text("O texto M3U excede 2 MB.", 413);
    const url = urlRaw ? safeRemoteUrl(urlRaw) : null;
    if (urlRaw && !url) return c.text("URL não permitida: use HTTP(S) público.", 400);
    try {
      const data = pasted.trim() ? pasted : await readLimitedText(url!.toString());
      const channels = parseM3u(data);
      if (!channels.length) return c.text("Nenhum canal HTTP(S) válido encontrado.", 400);
      await ensureIptv(c.env.DB);
      const id = crypto.randomUUID().replace(/-/g, "");
      await c.env.DB.prepare("INSERT INTO IptvSources(Id,Name,SourceUrl) VALUES(?,?,?)")
        .bind(id, name, url?.toString() || null).run();
      // Batches limit the number of prepared queries per D1 transaction.
      try {
        for (let start = 0; start < channels.length; start += 50) {
          const group = channels.slice(start, start + 50).map((ch) => c.env.DB.prepare(
            "INSERT INTO IptvChannels(Id,SourceId,Name,Category,Logo,StreamUrl) VALUES(?,?,?,?,?,?)"
          ).bind(crypto.randomUUID().replace(/-/g, ""), id, ch.name, ch.group, ch.logo, ch.streamUrl));
          await c.env.DB.batch(group);
        }
      } catch (err) {
        await c.env.DB.prepare("DELETE FROM IptvChannels WHERE SourceId=?").bind(id).run();
        await c.env.DB.prepare("DELETE FROM IptvSources WHERE Id=?").bind(id).run();
        throw err;
      }
      return c.redirect("/iptv", 303);
    } catch (err: any) {
      return c.text("Falha na importação: " + (err?.message || "erro desconhecido"), 400);
    }
  });

  app.post("/iptv/delete", async (c) => {
    const form = await c.req.formData();
    const id = String(form.get("id") || "");
    if (!/^[0-9a-f]{32}$/i.test(id)) return c.text("ID inválido", 400);
    await ensureIptv(c.env.DB);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM IptvChannels WHERE SourceId=?").bind(id),
      c.env.DB.prepare("DELETE FROM IptvSources WHERE Id=?").bind(id),
    ]);
    return c.redirect("/iptv", 303);
  });

  // Protected API: ordinary authenticated Jellyfin users may see channels.
  // Avoid returning StreamUrl: it can contain private provider credentials.
  app.get("/api/iptv/channels", async (c) => {
    await ensureIptv(c.env.DB);
    const result = await c.env.DB.prepare(
      "SELECT Id, Name, Category, Logo, SourceId FROM IptvChannels ORDER BY Category, Name LIMIT 1500"
    ).all();
    return c.json({ Items: (result.results || []).map((x: any) => ({
      Id: x.Id, Name: x.Name, Category: x.Category, Logo: x.Logo,
      SourceId: x.SourceId, PlayUrl: "/api/iptv/play/" + x.Id,
    })), TotalRecordCount: result.results?.length || 0 });
  });

  // Direct redirect is intentional: Cloudflare Workers do not transcode.
  // The final upstream URL is visible to the player, and may fail on browsers due to CORS/mixed content.
  app.get("/api/iptv/play/:id", async (c) => {
    await ensureIptv(c.env.DB);
    const row = await c.env.DB.prepare("SELECT StreamUrl FROM IptvChannels WHERE Id=?")
      .bind(c.req.param("id")).first<{ StreamUrl: string }>();
    const url = row && safeRemoteUrl(row.StreamUrl);
    if (!url) return c.text("Canal não encontrado", 404);
    return c.redirect(url.toString(), 302);
  });

  app.get("/iptv/watch", async (c) => {
    await ensureIptv(c.env.DB);
    const result = await c.env.DB.prepare(
      "SELECT Id, Name, Category FROM IptvChannels ORDER BY Category, Name LIMIT 1500"
    ).all();
    const rows = ((result.results || []) as any[]).map((ch) =>
      `<tr><td>${escapeHtml(ch.Name)}</td><td>${escapeHtml(ch.Category)}</td>
      <td><a href="/iptv/player/${encodeURIComponent(ch.Id)}">Assistir</a></td></tr>`
    ).join("");
    return c.html(shell(`<p><a href="/iptv">← Gerenciar listas</a></p><div class="panel">
      <table><tr><th>Canal</th><th>Categoria</th><th></th></tr>
      ${rows || '<tr><td colspan="3">Importe uma lista primeiro.</td></tr>'}</table></div>`));
  });

  app.get("/iptv/player/:id", async (c) => {
    await ensureIptv(c.env.DB);
    const row = await c.env.DB.prepare("SELECT Name, StreamUrl FROM IptvChannels WHERE Id=?")
      .bind(c.req.param("id")).first<{ Name: string; StreamUrl: string }>();
    const url = row && safeRemoteUrl(row.StreamUrl);
    if (!url) return c.notFound();
    return c.html(shell(`<p><a href="/iptv/watch">← Canais</a></p><h2>${escapeHtml(row!.Name)}</h2>
    <video controls autoplay playsinline style="width:100%;max-height:70vh;background:black" src="${escapeHtml(url.toString())}"></video>
    <p><small>Se não reproduzir, o formato do vídeo ou as restrições do provedor não são compatíveis com este navegador.</small></p>`));
  });
}
