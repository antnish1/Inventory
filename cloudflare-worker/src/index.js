const CATALOG_KEY = "catalog.json";
const SAVED_KEY = "shared-saved-list";

const corsHeaders = (env) => ({
  "access-control-allow-headers": "content-type, x-admin-password",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
  "vary": "Origin",
});

const json = (data, init = {}, env = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(env),
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
      return new Response(null, { headers: corsHeaders(env), status: 204 });
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, {}, env);
    }

    if (url.pathname === "/catalog" && request.method === "GET") {
      const object = await env.CATALOG_BUCKET.get(CATALOG_KEY);
      if (!object) return json({ error: "Catalog has not been uploaded yet." }, { status: 404 }, env);

      return new Response(object.body, {
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": object.httpMetadata?.contentType || "application/json; charset=utf-8",
          ...corsHeaders(env),
        },
      });
    }

    if (url.pathname === "/catalog" && request.method === "PUT") {
      if (!requireAdmin(request, env)) {
        return json({ error: "Invalid admin password." }, { status: 401 }, env);
      }

      const body = await request.text();
      let catalog;

      try {
        catalog = JSON.parse(body);
      } catch {
        return json({ error: "Invalid catalog JSON." }, { status: 400 }, env);
      }

      const validationError = validateCatalog(catalog);
      if (validationError) return json({ error: validationError }, { status: 400 }, env);

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
        env,
      );
    }

    if (url.pathname === "/saved" && request.method === "GET") {
      const keys = (await env.SAVED_KV.get(SAVED_KEY, "json")) || [];
      return json({ keys: Array.isArray(keys) ? keys : [] }, {}, env);
    }

    if (url.pathname === "/saved" && request.method === "PUT") {
      let payload;

      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid saved-list JSON." }, { status: 400 }, env);
      }

      const keys = Array.isArray(payload.keys)
        ? [...new Set(payload.keys.filter((key) => typeof key === "string"))].slice(0, 5000)
        : [];

      await env.SAVED_KV.put(SAVED_KEY, JSON.stringify(keys));
      return json({ ok: true, keys }, {}, env);
    }

    return json({ error: "Not found." }, { status: 404 }, env);
  },
};
