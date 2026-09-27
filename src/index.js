const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "cache-control": status === 200 ? "public, max-age=300" : "no-store",
      ...extra,
    },
  });

function normalizeOrientation(value) {
  if (!value) return null;
  const v = value.toLowerCase();
  return ["landscape", "portrait", "square"].includes(v) ? v : null;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizePhoto(photo) {
  return {
    id: photo.id,
    type: "photo",
    width: photo.width,
    height: photo.height,
    url: photo.url,
    photographer: {
      name: photo.photographer,
      url: photo.photographer_url,
      id: photo.photographer_id,
    },
    alt: photo.alt || "",
    average_color: photo.avg_color || null,
    src: photo.src || {},
    thumbnail: photo.src?.medium || photo.src?.small || null,
    download: photo.src?.original || null,
  };
}

function bestVideoFile(video) {
  const files = Array.isArray(video.video_files) ? video.video_files : [];
  const mp4 = files.filter((f) => f.file_type === "video/mp4");
  const sorted = mp4.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  return sorted[0] || files[0] || null;
}

function normalizeVideo(video) {
  const best = bestVideoFile(video);
  const picture = Array.isArray(video.video_pictures) ? video.video_pictures[0] : null;
  return {
    id: video.id,
    type: "video",
    width: video.width,
    height: video.height,
    duration: video.duration,
    url: video.url,
    creator: video.user ? {
      id: video.user.id,
      name: video.user.name,
      url: video.user.url,
    } : null,
    thumbnail: video.image || picture?.picture || null,
    download: best?.link || null,
    video_file: best ? {
      id: best.id,
      quality: best.quality,
      file_type: best.file_type,
      width: best.width,
      height: best.height,
      fps: best.fps,
      link: best.link,
    } : null,
    files: video.video_files || [],
  };
}

async function pexelsFetch(endpoint, env, cacheKey, ctx) {
  if (!env.PEXELS_API_KEY) {
    return { error: json({ success: false, error: "PEXELS_API_KEY is not configured" }, 500) };
  }

  const cache = caches.default;
  const cacheRequest = new Request(cacheKey, { method: "GET" });
  const cached = await cache.match(cacheRequest);
  if (cached) return { response: cached };

  const res = await fetch(endpoint, {
    headers: {
      Authorization: env.PEXELS_API_KEY,
      Accept: "application/json",
    },
  });

  const body = await res.text();
  if (!res.ok) {
    return {
      error: json({
        success: false,
        error: "Pexels API request failed",
        status: res.status,
        details: body.slice(0, 1000),
      }, res.status),
    };
  }

  const data = JSON.parse(body);
  const response = json(data, 200, { "cache-control": "public, max-age=86400" });
  ctx.waitUntil(cache.put(cacheRequest, response.clone()));
  return { data, response };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        success: true,
        service: "pexels-api",
        version: "1.0.0",
        domain: "pexels.aiautotool.com",
      });
    }

    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ success: false, error: "Missing required query parameter: q" }, 400);

    const page = clampInt(url.searchParams.get("page"), 1, 1000, 1);
    const perPage = clampInt(url.searchParams.get("per_page"), 1, 80, 30);
    const orientation = normalizeOrientation(url.searchParams.get("orientation"));
    const typeParam = (url.searchParams.get("type") || "").toLowerCase();

    let mode;
    if (url.pathname === "/v1/photos") mode = "photos";
    else if (url.pathname === "/v1/videos") mode = "videos";
    else if (url.pathname === "/v1/search") mode = typeParam === "videos" ? "videos" : "photos";
    else return json({ success: false, error: "Not found" }, 404);

    const upstream = new URL(mode === "videos"
      ? "https://api.pexels.com/videos/search"
      : "https://api.pexels.com/v1/search");
    upstream.searchParams.set("query", q);
    upstream.searchParams.set("page", String(page));
    upstream.searchParams.set("per_page", String(perPage));
    if (orientation) upstream.searchParams.set("orientation", orientation);

    const cacheKey = new URL(request.url);
    cacheKey.searchParams.sort();

    const result = await pexelsFetch(upstream.toString(), env, cacheKey.toString(), ctx);
    if (result.error) return result.error;
    const data = result.data || await result.response.clone().json();

    if (mode === "photos") {
      return json({
        success: true,
        query: q,
        type: "photos",
        page,
        per_page: perPage,
        total: data.total_results ?? null,
        next_page: data.next_page ?? null,
        prev_page: data.prev_page ?? null,
        results: (data.photos || []).map(normalizePhoto),
      }, 200, { "cache-control": "public, max-age=86400" });
    }

    return json({
      success: true,
      query: q,
      type: "videos",
      page,
      per_page: perPage,
      total: data.total_results ?? null,
      next_page: data.next_page ?? null,
      prev_page: data.prev_page ?? null,
      results: (data.videos || []).map(normalizeVideo),
    }, 200, { "cache-control": "public, max-age=86400" });
  },
};
