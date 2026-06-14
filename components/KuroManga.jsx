import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// SOURCES CONFIG
// ============================================================
const PROXY = "https://goodproxy.goodproxy.workers.dev/fetch?url=";
const WC    = "https://weebcentral.com";
const ASURA = "https://api.asurascans.com/api";
const MDX   = "https://api.mangadex.org";
const CDN_A = "https://cdn.asurascans.com/asura-images";

async function proxyGet(url, html = false) {
  try {
    const r = await fetch(PROXY + encodeURIComponent(url), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Referer": url.includes("weebcentral") ? "https://weebcentral.com/" : "https://asurascans.com/",
        "Origin":  url.includes("weebcentral") ? "https://weebcentral.com" : "https://asurascans.com",
        "Accept":  html ? "text/html,application/xhtml+xml" : "application/json",
      }
    });
    if (html) return r.text();
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { _raw: t }; }
  } catch (e) { return null; }
}

// ============================================================
// WEEBCENTRAL API
// ============================================================
const WC_API = {
  // Search — returns [{id, slug, title, cover, type, status}]
  search: async (q, offset = 0) => {
    const html = await proxyGet(
      `${WC}/search/data?text=${encodeURIComponent(q)}&limit=24&offset=${offset}&display_mode=Minimal+Display`,
      true
    );
    if (!html) return [];
    return parseWCCards(html);
  },

  // Browse — popular/latest/new
  browse: async (order = "trending", offset = 0, type = "", status = "") => {
    let url = `${WC}/search/data?limit=24&offset=${offset}&display_mode=Minimal+Display`;
    if (order === "trending") url += "&sort=Trending";
    else if (order === "latest") url += "&sort=Latest+Upload";
    else if (order === "rating") url += "&sort=Rating";
    else if (order === "new") url += "&sort=New";
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (status) url += `&status=${encodeURIComponent(status)}`;
    const html = await proxyGet(url, true);
    if (!html) return [];
    return parseWCCards(html);
  },

  // Series info
  info: async (id, slug) => {
    const html = await proxyGet(`${WC}/series/${id}/${slug}`, true);
    if (!html) return null;
    return parseWCInfo(html, id, slug);
  },

  // Full chapter list
  chapters: async (id) => {
    const html = await proxyGet(`${WC}/series/${id}/full-chapter-list`, true);
    if (!html) return [];
    return parseWCChapters(html);
  },

  // Chapter images
  images: async (chapId) => {
    const html = await proxyGet(
      `${WC}/chapters/${chapId}/images?is_prev=False&current_page=1&reading_style=long_strip`,
      true
    );
    if (!html) return [];
    const imgs = html.match(/https?:\/\/[^\s"'<>]+\.(?:webp|jpg|jpeg|png|gif)/gi) || [];
    return [...new Set(imgs)].filter(u => !u.includes("favicon") && !u.includes("logo") && !u.includes("icon"));
  },
};

// Parse WeebCentral search/browse cards
function parseWCCards(html) {
  const results = [];
  // Match article blocks
  const articleRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let am;
  while ((am = articleRe.exec(html)) !== null) {
    const block = am[1];
    const linkM = block.match(/href="https:\/\/weebcentral\.com\/series\/([A-Z0-9]+)\/([^"]+)"/);
    if (!linkM) continue;
    const id = linkM[1];
    const slug = linkM[2];
    const titleM = block.match(/data-tip="([^"]+)"|alt="([^"]+)"|title="([^"]+)"/);
    const title = titleM ? (titleM[1] || titleM[2] || titleM[3]) : slug.replace(/-/g, " ");
    const imgM = block.match(/src="([^"]+\.(?:webp|jpg|jpeg|png))"/);
    const cover = imgM ? imgM[1] : "";
    const typeM = block.match(/MANHWA|MANGA|MANHUA/i);
    const type = typeM ? typeM[0].toLowerCase() : "manga";
    const statusM = block.match(/Ongoing|Completed|Hiatus/i);
    const status = statusM ? statusM[0].toLowerCase() : "ongoing";
    results.push({ id, slug, title, cover, type, status, source: "weebcentral" });
  }
  return results;
}

// Parse WeebCentral series info page
function parseWCInfo(html, id, slug) {
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  const title = titleM ? titleM[1].replace(/ - WeebCentral.*/, "").trim() : slug.replace(/-/g, " ");
  const descM = html.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                html.match(/<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const description = descM ? descM[1].replace(/<[^>]+>/g, "").trim() : "";
  const imgM = html.match(/src="([^"]+)" alt="[^"]*cover[^"]*"/i) ||
               html.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*src="([^"]+)"/i) ||
               html.match(/property="og:image" content="([^"]+)"/i);
  const cover = imgM ? imgM[1] : "";
  const typeM = html.match(/MANHWA|MANGA|MANHUA/i);
  const type = typeM ? typeM[0].toLowerCase() : "manga";
  const statusM = html.match(/Ongoing|Completed|Hiatus/i);
  const status = statusM ? statusM[0].toLowerCase() : "ongoing";
  // Genres
  const genres = [];
  const genreRe = /genre[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let gm;
  while ((gm = genreRe.exec(html)) !== null) genres.push(gm[1].trim());
  // Rating
  const ratingM = html.match(/(\d+\.\d+)\s*\/\s*10/);
  const rating = ratingM ? ratingM[1] : null;
  return { id, slug, title, description, cover, type, status, genres, rating, source: "weebcentral" };
}

// Parse WeebCentral chapter list
function parseWCChapters(html) {
  const chapters = [];
  const re = /href="https:\/\/weebcentral\.com\/chapters\/([A-Z0-9]+)"[^>]*>[\s\S]*?(?:Chapter|Ch\.?)\s*([\d.]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    chapters.push({
      id: m[1],
      number: parseFloat(m[2]),
      title: "",
      source: "weebcentral",
    });
  }
  // Also try simpler pattern
  if (chapters.length === 0) {
    const re2 = /href="https:\/\/weebcentral\.com\/chapters\/([A-Z0-9]+)"/gi;
    const numRe = /Chapter\s*([\d.]+)|Ch\.\s*([\d.]+)/gi;
    const links = [...html.matchAll(/href="https:\/\/weebcentral\.com\/chapters\/([A-Z0-9]+)"/gi)];
    const nums = [...html.matchAll(/Chapter\s*([\d.]+)/gi)];
    links.forEach((l, i) => {
      chapters.push({
        id: l[1],
        number: parseFloat(nums[i]?.[1] || (i + 1)),
        title: "",
        source: "weebcentral",
      });
    });
  }
  return chapters.sort((a, b) => a.number - b.number);
}

// ============================================================
// ASURASCANS API (fallback)
// ============================================================
const ASURA_API = {
  search: async (q) => {
    const d = await proxyGet(`${ASURA}/series?page=1&page_size=12&name=${encodeURIComponent(q)}`);
    return (d?.data || []).map(m => ({ ...m, source: "asura" }));
  },
  browse: async (order = "popular", page = 1, type = "", status = "") => {
    let url = `${ASURA}/series?page=${page}&page_size=24&order=${order}`;
    if (type) url += `&type=${type}`;
    if (status) url += `&status=${status}`;
    const d = await proxyGet(url);
    return { data: (d?.data || []).map(m => ({ ...m, source: "asura" })), meta: d?.meta };
  },
  info: async (slug) => {
    const d = await proxyGet(`${ASURA}/series/${slug}`);
    return d?.series ? { ...d.series, source: "asura" } : null;
  },
  chapters: async (slug) => {
    const d = await proxyGet(`${ASURA}/series/${slug}/chapters`);
    return (d?.data || []).sort((a, b) => a.number - b.number).map(c => ({ ...c, source: "asura" }));
  },
  images: async (seriesSlug, chapNum, pageCount, publicUrl) => {
    // Try HTML parse
    try {
      const path = publicUrl
        ? `https://asurascans.com${publicUrl}/chapter/${chapNum}`
        : `https://asurascans.com/comics/${seriesSlug}-89829cb7/chapter/${chapNum}`;
      const html = await proxyGet(path, true);
      if (html && html.length > 5000) {
        const imgs = [];
        const re = /&quot;(https:\/\/cdn\.asurascans\.com\/asura-images\/chapters\/[^&]+\.(?:webp|jpg|png))&quot;/g;
        let m;
        while ((m = re.exec(html)) !== null) imgs.push(m[1]);
        if (imgs.length > 0) return imgs;
      }
    } catch {}
    // CDN fallback
    return Array.from({ length: pageCount || 25 }, (_, i) =>
      `${CDN_A}/chapters/${seriesSlug}/${chapNum}/${String(i + 1).padStart(3, "0")}.webp`
    );
  },
};

// ============================================================
// MANGADEX API (Japanese manga)
// ============================================================
const MDX_API = {
  search: async (q) => {
    const r = await fetch(`${MDX}/manga?title=${encodeURIComponent(q)}&limit=12&includes[]=cover_art&hasAvailableChapters=true`);
    const d = await r.json();
    return (d?.data || []).map(m => parseMDXManga(m));
  },
  browse: async (order = "popular", offset = 0) => {
    const orderMap = { popular: "followedCount", latest: "latestUploadedChapter", rating: "rating" };
    const sortKey = orderMap[order] || "followedCount";
    const r = await fetch(`${MDX}/manga?limit=24&offset=${offset}&includes[]=cover_art&hasAvailableChapters=true&order[${sortKey}]=desc`);
    const d = await r.json();
    return { data: (d?.data || []).map(m => parseMDXManga(m)), total: d?.total };
  },
  chapters: async (id) => {
    const r = await fetch(`${MDX}/manga/${id}/feed?translatedLanguage[]=en&limit=500&order[chapter]=asc&includeExternalUrl=0`);
    const d = await r.json();
    return (d?.data || []).map(c => ({
      id: c.id,
      number: parseFloat(c.attributes?.chapter || 0),
      title: c.attributes?.title || "",
      source: "mangadex",
    }));
  },
  images: async (chapId) => {
    const r = await fetch(`${MDX}/at-home/server/${chapId}`);
    const d = await r.json();
    if (!d?.baseUrl || !d?.chapter?.hash) return [];
    return (d.chapter.data || []).map(p => `${d.baseUrl}/data/${d.chapter.hash}/${p}`);
  },
};

function parseMDXManga(m) {
  const t = m.attributes?.title;
  const title = t?.en || Object.values(t || {})[0] || "Unknown";
  const covRel = m.relationships?.find(r => r.type === "cover_art");
  const cover = covRel?.attributes?.fileName
    ? `https://uploads.mangadex.org/covers/${m.id}/${covRel.attributes.fileName}.512.jpg`
    : "";
  return {
    id: m.id, slug: m.id, title, cover,
    type: "manga",
    status: m.attributes?.status || "ongoing",
    rating: m.attributes?.rating?.bayesian ? Number(m.attributes.rating.bayesian).toFixed(1) : null,
    source: "mangadex",
  };
}

// ============================================================
// UNIFIED SEARCH — all 3 sources
// ============================================================
async function unifiedSearch(q) {
  const [wc, asura, mdx] = await Promise.allSettled([
    WC_API.search(q),
    ASURA_API.search(q),
    MDX_API.search(q),
  ]);
  const wcR = wc.status === "fulfilled" ? wc.value : [];
  const asuraR = asura.status === "fulfilled" ? asura.value : [];
  const mdxR = mdx.status === "fulfilled" ? mdx.value : [];
  // Deduplicate by title
  const seen = new Set();
  const all = [...wcR, ...asuraR, ...mdxR].filter(m => {
    const key = m.title?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return all;
}

// ============================================================
// CSS
// ============================================================
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Syne:wght@700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#07070f;--bg2:#0d0d1e;--bg3:#121228;
  --s1:#161630;--s2:#1c1c38;--s3:#222244;
  --b1:#2c2c50;--b2:#3a3a68;
  --a1:#6d28d9;--a2:#7c3aed;--a3:#8b5cf6;--a4:#a78bfa;--a5:#c4b5fd;
  --pk:#db2777;--pk2:#ec4899;--pk3:#f472b6;
  --cy:#0891b2;--cy2:#06b6d4;--cy3:#67e8f9;
  --gn:#059669;--gn2:#10b981;
  --yw:#d97706;--yw2:#f59e0b;
  --t1:#f0f0ff;--t2:#b8b8d8;--t3:#7878a0;--t4:#404060;
  --glow:0 0 0 1px rgba(109,40,217,.4),0 4px 32px rgba(109,40,217,.3);
  --r:10px;--r2:14px;--r3:20px;
}
body{background:var(--bg);color:var(--t1);font-family:'Inter',sans-serif;min-height:100vh;overflow-x:hidden;}
::selection{background:rgba(109,40,217,.35);}
::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:var(--bg2);}::-webkit-scrollbar-thumb{background:var(--a2);border-radius:3px;}

/* NAV */
.nav{position:fixed;top:0;left:0;right:0;z-index:500;height:58px;
  background:rgba(7,7,15,.92);backdrop-filter:blur(24px);
  border-bottom:1px solid rgba(44,44,80,.6);
  display:flex;align-items:center;padding:0 20px;gap:16px;}
.logo{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;cursor:pointer;letter-spacing:-.3px;}
.lk{color:var(--a4);}
.lm{background:linear-gradient(130deg,var(--pk2),var(--yw2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.nav-links{display:flex;gap:2px;}
.nl{padding:6px 13px;border-radius:8px;font-size:13px;font-weight:500;color:var(--t3);
  cursor:pointer;border:none;background:transparent;transition:all .18s;font-family:'Inter',sans-serif;}
.nl:hover{color:var(--t1);background:var(--s1);}
.nl.on{color:var(--a4);background:rgba(109,40,217,.12);}
.nav-r{margin-left:auto;display:flex;align-items:center;gap:10px;}
.src-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;
  background:rgba(109,40,217,.15);border:1px solid rgba(109,40,217,.3);color:var(--a4);letter-spacing:.04em;}
.ns-wrap{position:relative;}
.ns-in{background:var(--s1);border:1px solid var(--b1);border-radius:9px;
  padding:7px 34px 7px 14px;color:var(--t1);font-size:13px;
  font-family:'Inter',sans-serif;width:196px;outline:none;transition:all .2s;}
.ns-in:focus{border-color:var(--a2);box-shadow:0 0 0 3px rgba(109,40,217,.15);width:250px;}
.ns-in::placeholder{color:var(--t4);}
.ns-btn{position:absolute;right:9px;top:50%;transform:translateY(-50%);
  background:none;border:none;cursor:pointer;color:var(--t3);font-size:15px;transition:color .2s;}
.ns-btn:hover{color:var(--a4);}

/* HERO */
.hero{padding:72px 24px 52px;text-align:center;position:relative;overflow:hidden;}
.hero-bg{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 80% 55% at 50% -5%,rgba(109,40,217,.2) 0%,transparent 65%),
             radial-gradient(ellipse 50% 35% at 80% 60%,rgba(219,39,119,.07) 0%,transparent 60%);}
.hero-line{position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--a2) 30%,var(--pk2) 70%,transparent);opacity:.45;}
.badge{display:inline-flex;align-items:center;gap:6px;
  background:rgba(109,40,217,.1);border:1px solid rgba(109,40,217,.25);
  border-radius:100px;padding:4px 13px;margin-bottom:18px;
  font-size:11px;color:var(--a4);font-weight:600;letter-spacing:.04em;}
.bdot{width:6px;height:6px;border-radius:50%;background:var(--a3);animation:bpulse 2s infinite;}
@keyframes bpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}
.htitle{font-family:'Syne',sans-serif;font-weight:800;
  font-size:clamp(26px,5.5vw,58px);line-height:1.06;margin-bottom:12px;letter-spacing:-.5px;}
.hg{background:linear-gradient(135deg,var(--a4),var(--pk3),var(--cy3));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hsub{font-size:14.5px;color:var(--t3);max-width:480px;margin:0 auto 28px;line-height:1.65;}
.sources-row{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:28px;}
.src-pill{display:flex;align-items:center;gap:5px;
  background:var(--s1);border:1px solid var(--b1);border-radius:100px;
  padding:4px 12px;font-size:11px;color:var(--t2);font-weight:500;}
.src-dot{width:6px;height:6px;border-radius:50%;background:var(--gn2);}
/* BIG SEARCH */
.bsearch{display:flex;max-width:600px;margin:0 auto 32px;
  background:var(--s1);border:1px solid var(--b1);border-radius:14px;
  padding:5px;transition:all .22s;box-shadow:0 4px 32px rgba(0,0,0,.3);}
.bsearch:focus-within{border-color:var(--a2);box-shadow:var(--glow);}
.bsin{flex:1;background:none;border:none;outline:none;color:var(--t1);
  font-size:15px;font-family:'Inter',sans-serif;padding:10px 14px;}
.bsin::placeholder{color:var(--t3);}
.bsbtn{background:linear-gradient(135deg,var(--a1),var(--a2));
  border:none;border-radius:10px;padding:10px 22px;
  color:#fff;font-size:13px;font-weight:600;cursor:pointer;
  font-family:'Inter',sans-serif;transition:all .2s;white-space:nowrap;}
.bsbtn:hover{opacity:.88;transform:translateY(-1px);}
/* STATS */
.stats{display:flex;justify-content:center;gap:36px;flex-wrap:wrap;}
.stat-n{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;
  background:linear-gradient(135deg,var(--a4),var(--pk2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.stat-l{font-size:10px;color:var(--t4);margin-top:2px;letter-spacing:.07em;text-transform:uppercase;}

/* SECTION */
.sec{padding:30px 22px;max-width:1500px;margin:0 auto;}
.sec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.sec-t{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;}
.sec-t::before{content:'';width:3px;height:20px;
  background:linear-gradient(to bottom,var(--a3),var(--pk2));border-radius:2px;display:block;}
.sec-more{font-size:12px;color:var(--a4);cursor:pointer;background:none;border:none;
  font-family:'Inter',sans-serif;font-weight:500;}
.sec-more:hover{opacity:.65;}

/* GRID */
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;}
.mgrid.lg{grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:16px;}

/* CARD */
.mc{cursor:pointer;border-radius:var(--r2);overflow:hidden;
  background:var(--s1);border:1px solid var(--b1);
  transition:transform .25s,border-color .25s,box-shadow .25s;position:relative;}
.mc:hover{transform:translateY(-5px);border-color:var(--a2);box-shadow:var(--glow);}
.mc:hover .mc-ov{opacity:1;}
.mc:hover .mc-img{transform:scale(1.05);}
.mc-iw{position:relative;overflow:hidden;}
.mc-img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:var(--s2);transition:transform .3s;}
.mc-ov{position:absolute;inset:0;opacity:0;transition:opacity .25s;
  background:linear-gradient(to top,rgba(7,7,15,.97) 0%,rgba(7,7,15,.3) 50%,transparent 100%);
  display:flex;align-items:flex-end;padding:10px;}
.mc-ov-btn{background:linear-gradient(135deg,var(--a1),var(--a2));
  border:none;border-radius:8px;padding:7px 12px;color:#fff;
  font-size:12px;font-weight:600;cursor:pointer;width:100%;
  font-family:'Inter',sans-serif;}
.tc{position:absolute;top:7px;left:7px;z-index:2;
  font-size:8.5px;font-weight:700;padding:2px 7px;border-radius:5px;
  text-transform:uppercase;letter-spacing:.07em;backdrop-filter:blur(8px);}
.tc-manhwa{background:rgba(109,40,217,.8);color:#ddd6fe;}
.tc-manga{background:rgba(219,39,119,.8);color:#fce7f3;}
.tc-manhua{background:rgba(8,145,178,.8);color:#cffafe;}
.sdot{position:absolute;top:7px;right:7px;z-index:2;
  width:7px;height:7px;border-radius:50%;border:1.5px solid rgba(0,0,0,.5);}
.sd-on{background:var(--gn2);}
.sd-co{background:var(--t4);}
/* Source indicator */
.src-tag{position:absolute;bottom:7px;right:7px;z-index:2;
  font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;
  backdrop-filter:blur(8px);text-transform:uppercase;letter-spacing:.05em;}
.src-wc{background:rgba(6,182,212,.7);color:#cffafe;}
.src-asura{background:rgba(109,40,217,.7);color:#ddd6fe;}
.src-mdx{background:rgba(219,39,119,.7);color:#fce7f3;}
.mc-b{padding:9px 10px 11px;}
.mc-title{font-size:11.5px;font-weight:600;color:var(--t1);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  line-height:1.4;margin-bottom:5px;}
.mc-meta{display:flex;align-items:center;justify-content:space-between;}
.mc-rat{font-size:11px;color:var(--yw2);font-weight:600;}
.mc-ch{font-size:10.5px;color:var(--t4);}

/* BROWSE */
.browse{padding:76px 22px 48px;max-width:1500px;margin:0 auto;}
.browse-h{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;margin-bottom:20px;}
.filters{background:var(--s1);border:1px solid var(--b1);border-radius:var(--r2);padding:14px 16px;margin-bottom:20px;}
.f-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.f-row:last-child{margin-bottom:0;}
.f-lbl{font-size:10px;color:var(--t4);font-weight:700;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;min-width:46px;}
.f-chips{display:flex;gap:5px;flex-wrap:wrap;}
.fchip{padding:5px 12px;border-radius:7px;font-size:11.5px;font-weight:500;
  cursor:pointer;border:1px solid var(--b1);background:var(--s2);color:var(--t3);
  transition:all .18s;font-family:'Inter',sans-serif;}
.fchip:hover{border-color:var(--a3);color:var(--t1);}
.fchip.on{background:rgba(109,40,217,.18);border-color:var(--a2);color:var(--a4);}
.fsel{background:var(--s2);border:1px solid var(--b1);border-radius:7px;
  padding:6px 11px;color:var(--t2);font-size:11.5px;
  font-family:'Inter',sans-serif;outline:none;cursor:pointer;}
.fsel:focus{border-color:var(--a2);}
.fsel option{background:var(--s2);}
.fdiv{width:1px;height:18px;background:var(--b1);}
.rn{font-size:12.5px;color:var(--t3);margin-bottom:12px;}
.rn strong{color:var(--t2);}
/* SOURCE TABS */
.src-tabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
.src-tab{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;
  cursor:pointer;border:1px solid var(--b1);background:var(--s1);color:var(--t3);
  transition:all .18s;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:5px;}
.src-tab:hover{border-color:var(--a3);color:var(--t1);}
.src-tab.on{background:rgba(109,40,217,.18);border-color:var(--a2);color:var(--a4);}
.src-tab .dot{width:6px;height:6px;border-radius:50%;background:var(--gn2);}

/* PAGINATION */
.pages{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:30px;flex-wrap:wrap;}
.pgb{background:var(--s1);border:1px solid var(--b1);border-radius:7px;
  padding:6px 13px;color:var(--t3);font-size:12px;font-weight:500;cursor:pointer;
  transition:all .18s;font-family:'Inter',sans-serif;}
.pgb:hover{border-color:var(--a3);color:var(--t1);}
.pgb.on{background:rgba(109,40,217,.2);border-color:var(--a2);color:var(--a4);font-weight:700;}
.pgb:disabled{opacity:.3;cursor:not-allowed;}

/* INFO */
.info{padding:76px 22px 48px;max-width:1160px;margin:0 auto;}
.info-hero{display:flex;gap:24px;background:var(--s1);border:1px solid var(--b1);
  border-radius:var(--r3);padding:24px;margin-bottom:28px;position:relative;overflow:hidden;}
.info-hero::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--a2),var(--pk2),var(--cy2));}
.info-cov{width:185px;flex-shrink:0;border-radius:var(--r);object-fit:cover;
  aspect-ratio:2/3;background:var(--s2);align-self:flex-start;}
.info-body{flex:1;min-width:0;}
.info-title{font-family:'Syne',sans-serif;font-size:clamp(18px,3vw,30px);
  font-weight:800;line-height:1.15;margin-bottom:10px;letter-spacing:-.3px;}
.info-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
.ichip{font-size:10px;font-weight:700;padding:3px 9px;border-radius:5px;text-transform:uppercase;letter-spacing:.06em;}
.im{background:rgba(109,40,217,.2);color:var(--a4);}
.img{background:rgba(219,39,119,.2);color:var(--pk2);}
.imh{background:rgba(8,145,178,.2);color:var(--cy2);}
.ion{background:rgba(5,150,105,.15);color:var(--gn2);}
.ico{background:rgba(120,120,160,.15);color:var(--t3);}
.src-info{background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);color:var(--cy2);}
.info-desc{font-size:13.5px;color:var(--t3);line-height:1.75;max-height:90px;overflow:hidden;transition:max-height .3s;}
.info-desc.exp{max-height:600px;}
.desc-tog{font-size:11.5px;color:var(--a4);cursor:pointer;background:none;border:none;
  font-family:'Inter',sans-serif;margin:7px 0 14px;display:block;font-weight:500;}
.genres{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px;}
.gtag{background:var(--s2);border:1px solid var(--b1);border-radius:6px;padding:3px 9px;font-size:11px;color:var(--t3);}
.istats{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px;}
.isl{font-size:10px;color:var(--t4);margin-bottom:2px;text-transform:uppercase;letter-spacing:.06em;}
.isv{font-size:13px;font-weight:600;color:var(--t1);}
.readbtn{background:linear-gradient(135deg,var(--a1),var(--a2));
  border:none;border-radius:10px;padding:10px 22px;color:#fff;
  font-size:13px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;
  transition:all .2s;display:inline-flex;align-items:center;gap:6px;}
.readbtn:hover{transform:translateY(-2px);box-shadow:var(--glow);}
/* CHAPTERS */
.ch-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;}
.ch-ht{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;}
.ch-cnt{font-size:11px;color:var(--t4);background:var(--s1);padding:3px 10px;border-radius:20px;}
.ch-sin{background:var(--s1);border:1px solid var(--b1);border-radius:8px;
  padding:6px 12px;color:var(--t1);font-size:12px;font-family:'Inter',sans-serif;outline:none;width:170px;}
.ch-sin:focus{border-color:var(--a2);}
.ch-sin::placeholder{color:var(--t4);}
.chgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));
  gap:7px;max-height:440px;overflow-y:auto;padding-right:4px;}
.chi{background:var(--s1);border:1px solid var(--b1);border-radius:10px;
  padding:11px 14px;cursor:pointer;transition:all .2s;
  display:flex;align-items:center;justify-content:space-between;}
.chi:hover{border-color:var(--a2);background:var(--s2);transform:translateX(3px);}
.chi-n{font-size:12.5px;font-weight:600;color:var(--t1);}
.chi-t{font-size:11px;color:var(--t4);margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:150px;}
.show-more{margin-top:8px;width:100%;background:var(--s1);border:1px solid var(--b1);
  border-radius:9px;padding:9px;color:var(--t3);cursor:pointer;font-size:12px;
  font-family:'Inter',sans-serif;transition:all .2s;}
.show-more:hover{border-color:var(--a2);color:var(--t1);}

/* READER */
.reader{background:#040408;min-height:100vh;padding-top:58px;}
.rnav{position:fixed;top:0;left:0;right:0;z-index:600;height:58px;
  background:rgba(4,4,8,.95);backdrop-filter:blur(20px);
  border-bottom:1px solid rgba(44,44,80,.5);
  display:flex;align-items:center;padding:0 14px;gap:8px;}
.rinfo{font-size:12px;color:var(--t3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;}
.rinfo strong{color:var(--t1);}
.rctrl{display:flex;gap:5px;align-items:center;flex-shrink:0;}
.rbtn{background:var(--s1);border:1px solid var(--b1);border-radius:7px;
  padding:5px 10px;color:var(--t2);font-size:11.5px;font-weight:500;cursor:pointer;
  transition:all .18s;font-family:'Inter',sans-serif;white-space:nowrap;}
.rbtn:hover{border-color:var(--a3);color:var(--a4);}
.rbtn:disabled{opacity:.3;cursor:not-allowed;}
.rbtn.on{background:rgba(109,40,217,.2);border-color:var(--a2);color:var(--a4);}
.ch-sel{background:var(--s1);border:1px solid var(--b1);border-radius:7px;
  padding:5px 9px;color:var(--t2);font-size:11.5px;font-family:'Inter',sans-serif;
  outline:none;cursor:pointer;max-width:130px;}
.ch-sel option{background:var(--s2);}
.scroll-c{display:flex;flex-direction:column;align-items:center;padding:14px 10px 80px;gap:1px;max-width:900px;margin:0 auto;}
.sc-img{width:100%;display:block;background:var(--s2);min-height:80px;}
.single-c{display:flex;flex-direction:column;align-items:center;padding:14px 10px 90px;max-width:900px;margin:0 auto;}
.sg-img{width:100%;display:block;background:var(--s2);}
.pbar{position:fixed;bottom:0;left:0;right:0;z-index:600;
  background:rgba(4,4,8,.92);backdrop-filter:blur(16px);border-top:1px solid rgba(44,44,80,.4);
  display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;}
.pnb{background:var(--s1);border:1px solid var(--b1);border-radius:8px;
  padding:7px 16px;color:var(--t1);font-size:12.5px;font-weight:600;cursor:pointer;
  transition:all .18s;font-family:'Inter',sans-serif;}
.pnb:hover{border-color:var(--a3);color:var(--a4);}
.pnb:disabled{opacity:.3;cursor:not-allowed;}
.plbl{font-size:12.5px;color:var(--t3);min-width:80px;text-align:center;font-weight:500;}

/* UTIL */
.loader{display:flex;align-items:center;justify-content:center;padding:80px;flex-direction:column;gap:14px;}
.lring{width:38px;height:38px;border:3px solid var(--b1);border-top-color:var(--a3);border-radius:50%;animation:spin .75s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.ltxt{font-size:13px;color:var(--t4);}
.skel{background:linear-gradient(90deg,var(--s1) 25%,var(--s2) 50%,var(--s1) 75%);
  background-size:200% 100%;animation:shim 1.4s infinite;border-radius:7px;}
@keyframes shim{0%{background-position:200% 0}100%{background-position:-200% 0}}
.empty{text-align:center;padding:80px 20px;}
.e-icon{font-size:48px;margin-bottom:14px;}
.e-t{font-size:17px;font-weight:700;margin-bottom:7px;}
.e-s{font-size:13.5px;color:var(--t3);}
.back{display:inline-flex;align-items:center;gap:7px;
  background:var(--s1);border:1px solid var(--b1);border-radius:9px;
  padding:7px 15px;color:var(--t3);font-size:13px;cursor:pointer;
  margin-bottom:20px;transition:all .18s;font-family:'Inter',sans-serif;}
.back:hover{border-color:var(--a2);color:var(--t1);}
.notice{background:rgba(109,40,217,.08);border:1px solid rgba(109,40,217,.2);
  border-radius:9px;padding:10px 14px;font-size:12.5px;color:var(--a4);margin-bottom:14px;}

@media(max-width:640px){
  .nav-links{display:none;}
  .ns-in{width:150px;}.ns-in:focus{width:190px;}
  .info-hero{flex-direction:column;}
  .info-cov{width:100%;max-height:260px;}
  .mgrid{grid-template-columns:repeat(3,1fr);gap:9px;}
  .hero{padding:66px 14px 40px;}
  .sec{padding:20px 12px;}
  .browse{padding:66px 12px 40px;}
  .stats{gap:18px;}
}
`;

// ============================================================
// COMPONENTS
// ============================================================
const Loader = ({ t = "Loading..." }) => (
  <div className="loader"><div className="lring" /><div className="ltxt">{t}</div></div>
);
const SkelGrid = ({ n = 12 }) => (
  <div className="mgrid">
    {Array(n).fill(0).map((_, i) => (
      <div key={i} className="mc">
        <div className="skel" style={{ aspectRatio: "2/3", width: "100%" }} />
        <div style={{ padding: "9px 10px 11px" }}>
          <div className="skel" style={{ height: 11, marginBottom: 6 }} />
          <div className="skel" style={{ height: 10, width: "50%" }} />
        </div>
      </div>
    ))}
  </div>
);

const srcTagMap = { weebcentral: "src-wc", asura: "src-asura", mangadex: "src-mdx" };
const srcLabelMap = { weebcentral: "WC", asura: "AS", mangadex: "MDX" };

const Card = ({ m, onClick }) => {
  const type = (m.type || "manhwa").toLowerCase();
  const tcMap = { manhwa: "tc-manhwa", manga: "tc-manga", manhua: "tc-manhua" };
  return (
    <div className="mc" onClick={() => onClick(m)}>
      <span className={`tc ${tcMap[type] || "tc-manhwa"}`}>{type}</span>
      <span className={`sdot ${m.status === "ongoing" ? "sd-on" : "sd-co"}`} />
      <span className={`src-tag ${srcTagMap[m.source] || "src-wc"}`}>{srcLabelMap[m.source] || "WC"}</span>
      <div className="mc-iw">
        <img className="mc-img" src={m.cover || m.cover_url || ""} alt={m.title} loading="lazy"
          onError={e => { e.target.src = `https://placehold.co/300x450/161630/8b5cf6?text=${encodeURIComponent((m.title || "").slice(0, 10))}`; }} />
        <div className="mc-ov"><button className="mc-ov-btn">▶ Read Now</button></div>
      </div>
      <div className="mc-b">
        <div className="mc-title">{m.title}</div>
        <div className="mc-meta">
          {m.rating && <span className="mc-rat">★ {Number(m.rating).toFixed ? Number(m.rating).toFixed(1) : m.rating}</span>}
          {m.chapter_count ? <span className="mc-ch">{m.chapter_count}ch</span> : <span />}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// HOME
// ============================================================
const Home = ({ onManga, onSearch, onBrowse }) => {
  const [pop, setPop] = useState([]);
  const [lat, setLat] = useState([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef();

  useEffect(() => {
    Promise.allSettled([
      WC_API.browse("trending"),
      WC_API.browse("latest"),
    ]).then(([p, l]) => {
      setPop(p.value?.slice(0, 18) || []);
      setLat(l.value?.slice(0, 18) || []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ paddingTop: 58 }}>
      <div className="hero">
        <div className="hero-bg" /><div className="hero-line" />
        <div className="badge"><div className="bdot" />3 Sources · No Ads · All Chapters</div>
        <h1 className="htitle">Read Manhwa, Manga<br /><span className="hg">&amp; Manhua — All in One</span></h1>
        <p className="hsub">Powered by 3 sources — WeebCentral, AsuraScans & MangaDex — for maximum coverage.</p>
        <div className="sources-row">
          <div className="src-pill"><div className="src-dot" />WeebCentral</div>
          <div className="src-pill"><div className="src-dot" />AsuraScans</div>
          <div className="src-pill"><div className="src-dot" />MangaDex</div>
        </div>
        <div className="bsearch">
          <input ref={ref} className="bsin" placeholder="Search Solo Leveling, Tower of God, Naruto..."
            onKeyDown={e => e.key === "Enter" && onSearch(ref.current?.value)} />
          <button className="bsbtn" onClick={() => onSearch(ref.current?.value)}>Search →</button>
        </div>
        <div className="stats">
          <div><div className="stat-n">50K+</div><div className="stat-l">Titles</div></div>
          <div><div className="stat-n">3</div><div className="stat-l">Sources</div></div>
          <div><div className="stat-n">4K</div><div className="stat-l">Quality</div></div>
          <div><div className="stat-n">Free</div><div className="stat-l">Forever</div></div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-hd">
          <div className="sec-t">🔥 Trending</div>
          <button className="sec-more" onClick={() => onBrowse("trending")}>View all →</button>
        </div>
        {loading ? <SkelGrid /> : <div className="mgrid">{pop.map((m, i) => <Card key={i} m={m} onClick={onManga} />)}</div>}
      </div>
      <div className="sec">
        <div className="sec-hd">
          <div className="sec-t">🆕 Latest Updates</div>
          <button className="sec-more" onClick={() => onBrowse("latest")}>View all →</button>
        </div>
        {loading ? <SkelGrid /> : <div className="mgrid">{lat.map((m, i) => <Card key={i} m={m} onClick={onManga} />)}</div>}
      </div>
    </div>
  );
};

// ============================================================
// BROWSE
// ============================================================
const TCHIPS = [{ v: "", l: "All" }, { v: "MANHWA", l: "Manhwa 🇰🇷" }, { v: "MANGA", l: "Manga 🇯🇵" }, { v: "MANHUA", l: "Manhua 🇨🇳" }];
const SCHIPS = [{ v: "", l: "All" }, { v: "Ongoing", l: "Ongoing" }, { v: "Completed", l: "Completed" }, { v: "Hiatus", l: "Hiatus" }];
const ORDERS = [{ v: "trending", l: "Trending" }, { v: "latest", l: "Latest" }, { v: "rating", l: "Top Rated" }, { v: "new", l: "New" }];
const SRC_TABS = [
  { v: "wc", l: "WeebCentral", desc: "Huge library" },
  { v: "asura", l: "AsuraScans", desc: "Popular manhwa" },
  { v: "mdx", l: "MangaDex", desc: "Japanese manga" },
];

const Browse = ({ initQ = "", initOrder = "trending", onManga }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState("wc");
  const [pg, setPg] = useState(1);
  const [totalPg, setTotalPg] = useState(1);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [order, setOrder] = useState(initOrder);
  const [q, setQ] = useState(initQ);
  const ref = useRef();

  const load = useCallback(async (page, srcV, t, s, o, query) => {
    setLoading(true);
    try {
      if (query?.trim()) {
        // SEARCH
        if (srcV === "wc") {
          const r = await WC_API.search(query);
          setItems(r); setTotalPg(1);
        } else if (srcV === "asura") {
          const r = await ASURA_API.search(query);
          setItems(r); setTotalPg(1);
        } else {
          const r = await MDX_API.search(query);
          setItems(r); setTotalPg(1);
        }
      } else {
        // BROWSE
        const offset = (page - 1) * 24;
        if (srcV === "wc") {
          const r = await WC_API.browse(o, offset, t, s);
          setItems(r); setTotalPg(Math.ceil(r.length > 0 ? 50 : 1));
        } else if (srcV === "asura") {
          const r = await ASURA_API.browse(o, page, t.toLowerCase(), s.toLowerCase());
          setItems(r.data || []); setTotalPg(r.meta?.total_page || 1);
        } else {
          const r = await MDX_API.browse(o, offset);
          setItems(r.data || []); setTotalPg(Math.ceil((r.total || 24) / 24));
        }
      }
    } catch (e) { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1, src, type, status, order, q); }, [src, type, status, order]);
  useEffect(() => { if (initQ) { setQ(initQ); load(1, src, type, status, order, initQ); } }, [initQ]);

  const doSearch = () => {
    const val = ref.current?.value?.trim() || "";
    setQ(val); setPg(1); load(1, src, type, status, order, val);
  };
  const clearSearch = () => {
    setQ(""); if (ref.current) ref.current.value = "";
    setPg(1); load(1, src, type, status, order, "");
  };
  const changePg = (p) => { setPg(p); load(p, src, type, status, order, q); window.scrollTo({ top: 0 }); };

  return (
    <div className="browse">
      <div className="browse-h">Browse</div>

      {/* Source tabs */}
      <div className="src-tabs">
        {SRC_TABS.map(s => (
          <button key={s.v} className={`src-tab ${src === s.v ? "on" : ""}`}
            onClick={() => { setSrc(s.v); setPg(1); }}>
            <div className="dot" />{s.l}
            <span style={{ fontSize: 10, color: "var(--t4)", fontWeight: 400 }}>{s.desc}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div className="bsearch" style={{ flex: 1, maxWidth: 520, margin: 0 }}>
          <input ref={ref} className="bsin" placeholder="Search titles..."
            defaultValue={q} onKeyDown={e => e.key === "Enter" && doSearch()} />
          <button className="bsbtn" onClick={doSearch}>Search</button>
        </div>
        {q && <button className="back" onClick={clearSearch} style={{ margin: 0 }}>✕ Clear</button>}
      </div>

      {/* Filters */}
      <div className="filters">
        <div className="f-row">
          <span className="f-lbl">Type</span>
          <div className="f-chips">
            {TCHIPS.map(c => (
              <button key={c.v} className={`fchip ${type === c.v ? "on" : ""}`}
                onClick={() => { setType(c.v); setPg(1); }}>{c.l}</button>
            ))}
          </div>
          <div className="fdiv" />
          <span className="f-lbl">Status</span>
          <div className="f-chips">
            {SCHIPS.map(c => (
              <button key={c.v} className={`fchip ${status === c.v ? "on" : ""}`}
                onClick={() => { setStatus(c.v); setPg(1); }}>{c.l}</button>
            ))}
          </div>
        </div>
        {!q && (
          <div className="f-row">
            <span className="f-lbl">Sort</span>
            <div className="f-chips">
              {ORDERS.map(o => (
                <button key={o.v} className={`fchip ${order === o.v ? "on" : ""}`}
                  onClick={() => { setOrder(o.v); setPg(1); }}>{o.l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {q && <div style={{ marginBottom: 12, fontSize: 13, color: "var(--t3)" }}>Results for "<strong style={{ color: "var(--t1)" }}>{q}</strong>"</div>}
      {!q && !loading && <div className="rn">Showing <strong>{items.length}</strong> titles</div>}

      {loading ? <SkelGrid n={24} /> : items.length === 0 ? (
        <div className="empty"><div className="e-icon">📭</div><div className="e-t">Nothing found</div><div className="e-s">Try different filters or another source tab</div></div>
      ) : (
        <>
          <div className="mgrid lg">{items.map((m, i) => <Card key={i} m={m} onClick={onManga} />)}</div>
          {!q && totalPg > 1 && (
            <div className="pages">
              <button className="pgb" disabled={pg <= 1} onClick={() => changePg(pg - 1)}>← Prev</button>
              {[...Array(Math.min(7, totalPg))].map((_, i) => {
                const n = Math.max(1, pg - 3) + i;
                if (n > totalPg) return null;
                return <button key={n} className={`pgb ${pg === n ? "on" : ""}`} onClick={() => changePg(n)}>{n}</button>;
              })}
              <button className="pgb" disabled={pg >= totalPg} onClick={() => changePg(pg + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================
// INFO
// ============================================================
const Info = ({ m, onBack, onRead }) => {
  const [info, setInfo] = useState(null);
  const [chaps, setChaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exp, setExp] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [chQ, setChQ] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const load = async () => {
      try {
        let infoData = null;
        let chapData = [];

        if (m.source === "weebcentral") {
          const id = m.id;
          const slug = m.slug;
          [infoData, chapData] = await Promise.all([
            WC_API.info(id, slug),
            WC_API.chapters(id),
          ]);
        } else if (m.source === "asura") {
          [infoData, chapData] = await Promise.all([
            ASURA_API.info(m.slug),
            ASURA_API.chapters(m.slug),
          ]);
        } else {
          // MangaDex
          const r = await fetch(`https://api.mangadex.org/manga/${m.id}?includes[]=cover_art&includes[]=author`);
          const d = await r.json();
          infoData = parseMDXManga(d.data);
          chapData = await MDX_API.chapters(m.id);
        }
        setInfo(infoData || m);
        setChaps(chapData);
      } catch (e) {
        console.error(e);
        setInfo(m);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [m.id]);

  const filtered = chaps.filter(c =>
    chQ ? String(c.number).includes(chQ) || (c.title || "").toLowerCase().includes(chQ.toLowerCase()) : true
  );
  const shown = showAll ? filtered : filtered.slice(0, 100);
  const cover = info?.cover || m.cover || m.cover_url || "";
  const type = (info?.type || m.type || "manhwa").toLowerCase();
  const tcMap = { manhwa: "im", manga: "img", manhua: "imh" };

  if (loading) return <div style={{ paddingTop: 80 }}><Loader t="Loading..." /></div>;

  return (
    <div className="info">
      <button className="back" onClick={onBack}>← Back</button>
      <div className="info-hero">
        <img className="info-cov" src={cover} alt={info?.title || m.title}
          onError={e => { e.target.src = `https://placehold.co/185x278/161630/8b5cf6?text=No+Cover`; }} />
        <div className="info-body">
          <h1 className="info-title">{info?.title || m.title}</h1>
          <div className="info-chips">
            <span className={`ichip ${tcMap[type] || "im"}`}>{type}</span>
            <span className={`ichip ${(info?.status || "").toLowerCase() === "ongoing" ? "ion" : "ico"}`}>{info?.status || "unknown"}</span>
            {info?.rating && <span style={{ fontSize: 12, color: "var(--yw2)", fontWeight: 600 }}>★ {info.rating}</span>}
            <span className={`ichip src-info`}>{m.source === "weebcentral" ? "WeebCentral" : m.source === "asura" ? "AsuraScans" : "MangaDex"}</span>
          </div>
          {info?.genres?.length > 0 && (
            <div className="genres">{info.genres.slice(0, 8).map((g, i) => <span key={i} className="gtag">{g?.name || g}</span>)}</div>
          )}
          {info?.description && (
            <>
              <div className={`info-desc ${exp ? "exp" : ""}`} dangerouslySetInnerHTML={{ __html: info.description }} />
              <button className="desc-tog" onClick={() => setExp(p => !p)}>{exp ? "Show less ↑" : "Read more ↓"}</button>
            </>
          )}
          <div className="istats">
            <div><div className="isl">Chapters</div><div className="isv">{chaps.length || info?.chapter_count || "—"}</div></div>
            {info?.author && <div><div className="isl">Author</div><div className="isv">{info.author}</div></div>}
            {info?.artist && <div><div className="isl">Artist</div><div className="isv">{info.artist}</div></div>}
          </div>
          {chaps.length > 0 && (
            <button className="readbtn" onClick={() => onRead(m, chaps[0], chaps, info)}>
              ▶ Start Reading — Ch.{chaps[0].number}
            </button>
          )}
        </div>
      </div>

      {chaps.length === 0 ? (
        <div className="notice">⚠ No chapters found. Try searching this title on another source.</div>
      ) : (
        <>
          <div className="ch-hd">
            <div className="ch-ht">Chapters <span className="ch-cnt">{chaps.length}</span></div>
            <input className="ch-sin" placeholder="Search chapter..." value={chQ} onChange={e => setChQ(e.target.value)} />
          </div>
          <div className="chgrid">
            {shown.map((ch, i) => (
              <div key={i} className="chi" onClick={() => onRead(m, ch, chaps, info)}>
                <div>
                  <div className="chi-n">Chapter {ch.number}</div>
                  {ch.title && <div className="chi-t">{ch.title}</div>}
                </div>
              </div>
            ))}
          </div>
          {!showAll && filtered.length > 100 && (
            <button className="show-more" onClick={() => setShowAll(true)}>Show all {filtered.length} chapters ↓</button>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================
// READER
// ============================================================
const Reader = ({ m, ch, chaps, info, onBack, onChChange }) => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("scroll");
  const [cur, setCur] = useState(0);
  const [errSet, setErrSet] = useState(new Set());
  const topRef = useRef();

  useEffect(() => {
    setLoading(true);
    setCur(0);
    setErrSet(new Set());

    const fetchImgs = async () => {
      try {
        let imgs = [];
        if (ch.source === "weebcentral" || m.source === "weebcentral") {
          imgs = await WC_API.images(ch.id);
        } else if (ch.source === "mangadex" || m.source === "mangadex") {
          imgs = await MDX_API.images(ch.id);
        } else {
          imgs = await ASURA_API.images(m.slug, ch.number, ch.page_count, info?.public_url);
        }
        setPages(imgs);
      } catch (e) {
        console.error(e);
        setPages([]);
      } finally {
        setLoading(false);
      }
    };
    fetchImgs();
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ch.id]);

  const idx = chaps.findIndex(c => c.id === ch.id);
  const hasPrev = idx > 0;
  const hasNext = idx < chaps.length - 1;
  const markErr = i => setErrSet(prev => new Set([...prev, i]));

  return (
    <div className="reader" ref={topRef}>
      <div className="rnav">
        <button className="rbtn" onClick={onBack}>← Back</button>
        <div className="rinfo"><strong>{m.title}</strong> · Ch.{ch.number}{ch.title ? ` — ${ch.title}` : ""}</div>
        <div className="rctrl">
          <button className={`rbtn ${mode === "scroll" ? "on" : ""}`} onClick={() => setMode("scroll")}>≡</button>
          <button className={`rbtn ${mode === "single" ? "on" : ""}`} onClick={() => setMode("single")}>□</button>
          <select className="ch-sel" value={ch.id}
            onChange={e => { const f = chaps.find(c => String(c.id) === e.target.value); if (f) onChChange(f); }}>
            {chaps.map((c, i) => <option key={i} value={c.id}>Ch.{c.number}{c.title ? ` — ${c.title}` : ""}</option>)}
          </select>
          <button className="rbtn" disabled={!hasPrev} onClick={() => onChChange(chaps[idx - 1])}>‹ Prev</button>
          <button className="rbtn" disabled={!hasNext} onClick={() => onChChange(chaps[idx + 1])}>Next ›</button>
        </div>
      </div>

      {loading ? <Loader t="Loading pages..." /> : pages.length === 0 ? (
        <div className="empty" style={{ paddingTop: 100 }}>
          <div className="e-icon">😕</div>
          <div className="e-t">Pages not available</div>
          <div className="e-s">Try another chapter or go back and use a different source.</div>
        </div>
      ) : mode === "scroll" ? (
        <div className="scroll-c">
          {pages.map((url, i) => !errSet.has(i) && (
            <img key={i} className="sc-img" src={url} alt={`Page ${i + 1}`} loading="lazy"
              onError={() => markErr(i)} />
          ))}
        </div>
      ) : (
        <>
          <div className="single-c">
            {pages[cur] && !errSet.has(cur) ? (
              <img className="sg-img" src={pages[cur]} alt={`Page ${cur + 1}`} onError={() => markErr(cur)} />
            ) : <div style={{ color: "var(--t3)", textAlign: "center", padding: 60 }}>Image unavailable</div>}
          </div>
          <div className="pbar">
            <button className="pnb" disabled={cur === 0} onClick={() => setCur(p => p - 1)}>← Prev</button>
            <span className="plbl">{cur + 1} / {pages.length}</span>
            <button className="pnb" disabled={cur >= pages.length - 1} onClick={() => setCur(p => p + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================
// APP
// ============================================================
export default function KuroManga() {
  const [pg, setPg] = useState("home");
  const [selM, setSelM] = useState(null);
  const [selCh, setSelCh] = useState(null);
  const [selChaps, setSelChaps] = useState([]);
  const [selInfo, setSelInfo] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [browseOrder, setBrowseOrder] = useState("trending");

  const goManga = m => { setSelM(m); setPg("info"); };
  const goRead = (m, ch, chaps, info) => { setSelM(m); setSelCh(ch); setSelChaps(chaps); setSelInfo(info); setPg("reader"); };
  const goSearch = q => { if (!q?.trim()) return; setSearchQ(q); setPg("browse"); };
  const goBrowse = (order = "trending") => { setBrowseOrder(order); setSearchQ(""); setPg("browse"); };

  return (
    <>
      <style>{CSS}</style>
      {pg !== "reader" && (
        <nav className="nav">
          <div className="logo" onClick={() => setPg("home")}><span className="lk">KURO</span><span className="lm">MANGA</span></div>
          <div className="nav-links">
            <button className={`nl ${pg === "home" ? "on" : ""}`} onClick={() => setPg("home")}>Home</button>
            <button className={`nl ${pg === "browse" ? "on" : ""}`} onClick={() => goBrowse()}>Browse</button>
          </div>
          <div className="nav-r">
            <span className="src-badge">3 Sources</span>
            <div className="ns-wrap">
              <input className="ns-in" placeholder="Search..."
                onKeyDown={e => e.key === "Enter" && goSearch(e.target.value)} />
              <button className="ns-btn" onClick={e => goSearch(e.target.closest(".ns-wrap").querySelector("input").value)}>⌕</button>
            </div>
          </div>
        </nav>
      )}
      {pg === "home"   && <Home onManga={goManga} onSearch={goSearch} onBrowse={goBrowse} />}
      {pg === "browse" && <Browse key={`${browseOrder}-${searchQ}`} initQ={searchQ} initOrder={browseOrder} onManga={goManga} />}
      {pg === "info"   && selM && <Info m={selM} onBack={() => setPg("home")} onRead={goRead} />}
      {pg === "reader" && selM && selCh && (
        <Reader m={selM} ch={selCh} chaps={selChaps} info={selInfo}
          onBack={() => setPg("info")} onChChange={ch => setSelCh(ch)} />
      )}
    </>
  );
}
