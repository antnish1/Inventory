const CATALOG_KEY = "catalog.json";
const SAVED_KEY = "shared-saved-list";

const getAllowedOrigin = (request, env) => {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowed.includes("*")) return "*";
  return allowed.includes(origin) ? origin : allowed[0] || "*";
};

const corsHeaders = (request, env) => ({
  "access-control-allow-headers": "content-type, x-admin-password",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-origin": getAllowedOrigin(request, env),
  "vary": "Origin",
});

const json = (data, init = {}, request, env = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
      ...(init.headers || {}),
    },
  });

const validateCatalog = (catalog) => {
  if (!catalog || typeof catalog !== "object") return "Catalog must be a JSON object.";
  if (!Array.isArray(catalog.parts)) return "Catalog must include a parts array.";
  if (!Number.isFinite(Number(catalog.rowCount))) return "Catalog must include rowCount.";
  return "";
};

const requireAdmin = (request, env) => {
  const expected = env.ADMIN_PASSWORD;
  const provided = request.headers.get("x-admin-password");
  return Boolean(expected && provided === expected);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env), status: 204 });
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, {}, request, env);
    }

    if (url.pathname === "/catalog" && request.method === "GET") {
      const object = await env.CATALOG_BUCKET.get(CATALOG_KEY);
      if (!object) return json({ error: "Catalog has not been uploaded yet." }, { status: 404 }, request, env);

      return new Response(object.body, {
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": object.httpMetadata?.contentType || "application/json; charset=utf-8",
          ...corsHeaders(request, env),
        },
      });
    }

    if (url.pathname === "/catalog" && request.method === "PUT") {
      if (!requireAdmin(request, env)) {
        return json({ error: "Invalid admin password." }, { status: 401 }, request, env);
      }

      const body = await request.text();
      let catalog;

      try {
        catalog = JSON.parse(body);
      } catch {
        return json({ error: "Invalid catalog JSON." }, { status: 400 }, request, env);
      }

      const validationError = validateCatalog(catalog);
      if (validationError) return json({ error: validationError }, { status: 400 }, request, env);

      await env.CATALOG_BUCKET.put(CATALOG_KEY, body, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });

      return json(
        {
          ok: true,
          rowCount: catalog.rowCount,
          sourceFile: catalog.sourceFile || "",
        },
        {},
        request,
        env,
      );
    }

    if (url.pathname === "/saved" && request.method === "GET") {
      const keys = (await env.SAVED_KV.get(SAVED_KEY, "json")) || [];
      return json({ keys: Array.isArray(keys) ? keys : [] }, {}, request, env);
    }

    if (url.pathname === "/saved" && request.method === "PUT") {
      let payload;

      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid saved-list JSON." }, { status: 400 }, request, env);
      }

      const keys = Array.isArray(payload.keys)
        ? [...new Set(payload.keys.filter((key) => typeof key === "string"))].slice(0, 5000)
        : [];

      await env.SAVED_KV.put(SAVED_KEY, JSON.stringify(keys));
      return json({ ok: true, keys }, {}, request, env);
    }

    return json({ error: "Not found." }, { status: 404 }, request, env);
  },
};
