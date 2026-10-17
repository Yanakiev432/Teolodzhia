/**
 * TEOLODZHIYA LIBRARY PROXY v1.6
 * --------------------------------
 * Full replacement preserving v1.5 behavior and secrets.
 *
 * Existing Worker secrets (KEEP THEM):
 *   APPS_SCRIPT_SECRET
 *   GPT_ACTION_KEY
 *
 * Additive work-aware routes:
 *   POST /search-works
 *   POST /works
 */

const WORKER_VERSION = "1.6";
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzZwuOQCM64fEOPhQtSUVdYEBjLqn0yOgtbgwnOepxYmxsDYxNjzjRkHb1_0OP51wgaYA/exec";

function corsHeaders(extra = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      "Authorization,Content-Type,X-API-Key,api-key",
    ...extra
  };
}

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: corsHeaders()
    }
  );
}

function htmlResponse(html, status = 200) {
  return new Response(
    html,
    {
      status,
      headers: corsHeaders({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300"
      })
    }
  );
}

function unauthorized() {
  return jsonResponse(
    {
      ok: false,
      error: "Unauthorized"
    },
    401
  );
}

function bearerToken(request) {
  const value =
    request.headers.get("authorization") || "";

  const match =
    value.match(/^Bearer\s+(.+)$/i);

  return match
    ? match[1].trim()
    : "";
}

function apiKeyToken(request) {
  return String(
    request.headers.get("x-api-key") ||
    request.headers.get("api-key") ||
    ""
  ).trim();
}

function checkActionAuth(request, env) {
  if (!env.GPT_ACTION_KEY) {
    return false;
  }

  const supplied =
    bearerToken(request) ||
    apiKeyToken(request);

  return supplied === env.GPT_ACTION_KEY;
}

async function readJsonBody(request) {
  try {
    const body = await request.json();

    return (
      body &&
      typeof body === "object" &&
      !Array.isArray(body)
    )
      ? body
      : {};
  } catch {
    return {};
  }
}

function normalizeView(value) {
  value = String(value || "sources")
    .trim()
    .toLowerCase();

  return (
    value === "works" ||
    value === "work" ||
    value === "logical"
  )
    ? "works"
    : "sources";
}

async function appsScriptCall(
  env,
  operation,
  params
) {
  if (!env.APPS_SCRIPT_SECRET) {
    throw new Error(
      "APPS_SCRIPT_SECRET is not configured."
    );
  }

  const url =
    new URL(APPS_SCRIPT_URL);

  url.searchParams.set(
    "secret",
    env.APPS_SCRIPT_SECRET
  );

  url.searchParams.set(
    "op",
    operation
  );

  for (
    const [key, value]
    of Object.entries(params || {})
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    url.searchParams.set(
      key,
      String(value)
    );
  }

  const response =
    await fetch(
      url.toString(),
      {
        method: "GET",
        redirect: "follow",
        headers: {
          "accept": "application/json"
        }
      }
    );

  const text =
    await response.text();

  let parsed;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    throw new Error(
      "Apps Script returned non-JSON response: " +
      text.slice(0, 500)
    );
  }

  if (!response.ok) {
    throw new Error(
      "Apps Script HTTP " +
      response.status +
      ": " +
      JSON.stringify(parsed).slice(
        0,
        700
      )
    );
  }

  return parsed;
}

function privacyHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Teolodzhia Library Privacy Policy</title>
</head>
<body>
<h1>Teolodzhia Library Privacy Policy</h1>
<p>
This service provides read-only access to the indexed
Teolodzhia theological research corpus.
</p>
<p>
The service supports source search, logical-work search,
passage retrieval, paginated source catalogue listing, and
paginated logical-work catalogue listing. It does not provide
general browsing access to the owner's Google Drive.
</p>
<p>
Search terms and relevant portions of a request may be
processed solely to locate indexed sources and passages.
</p>
<p>
The service does not sell user data and is not used for advertising.
</p>
</body>
</html>`;
}

function clampSearchMax(value) {
  return Math.max(
    1,
    Math.min(
      Number(value) || 8,
      10
    )
  );
}

function clampReadMax(value) {
  return Math.max(
    1,
    Math.min(
      Number(value) || 4,
      5
    )
  );
}

function clampPage(value) {
  return Math.max(
    1,
    Number(value) || 1
  );
}

function clampPageSize(value) {
  return Math.max(
    1,
    Math.min(
      Number(value) || 250,
      500
    )
  );
}

async function handleSearch(
  env,
  body,
  view
) {
  const query =
    String(
      body.query || ""
    ).trim();

  if (!query) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing query."
      },
      400
    );
  }

  const result =
    await appsScriptCall(
      env,
      "search",
      {
        query,
        maxResults:
          clampSearchMax(
            body.maxResults
          ),
        view:
          normalizeView(view)
      }
    );

  return jsonResponse(result);
}

async function handleList(
  env,
  body,
  view
) {
  const result =
    await appsScriptCall(
      env,
      "list",
      {
        page:
          clampPage(
            body.page
          ),

        pageSize:
          clampPageSize(
            body.pageSize
          ),

        sort:
          String(
            body.sort ||
            "title"
          ),

        view:
          normalizeView(view)
      }
    );

  return jsonResponse(result);
}

export default {
  async fetch(request, env) {
    try {
      const url =
        new URL(request.url);

      const path =
        url.pathname.replace(
          /\/+$/,
          ""
        ) || "/";

      if (request.method === "OPTIONS") {
        return new Response(
          null,
          {
            status: 204,
            headers: corsHeaders()
          }
        );
      }

      if (
        request.method === "GET" &&
        path === "/"
      ) {
        return jsonResponse({
          ok: true,
          service:
            "Teolodzhia Library Proxy",
          version:
            WORKER_VERSION,
          routes: [
            "/health",
            "/privacy",
            "/upstream-test",
            "/search",
            "/search-works",
            "/read",
            "/list",
            "/works"
          ]
        });
      }

      if (
        request.method === "GET" &&
        path === "/health"
      ) {
        return jsonResponse({
          ok: true,
          service:
            "Teolodzhia Library Proxy",
          version:
            WORKER_VERSION
        });
      }

      if (
        request.method === "GET" &&
        path === "/privacy"
      ) {
        return htmlResponse(
          privacyHtml()
        );
      }

      if (
        request.method === "GET" &&
        path === "/upstream-test"
      ) {
        const upstream =
          await fetch(
            APPS_SCRIPT_URL,
            {
              method: "GET",
              redirect: "follow"
            }
          );

        return new Response(
          await upstream.text(),
          {
            status:
              upstream.status,
            headers:
              corsHeaders()
          }
        );
      }

      const allowedPostPaths =
        new Set([
          "/search",
          "/search-works",
          "/read",
          "/list",
          "/works"
        ]);

      if (!allowedPostPaths.has(path)) {
        return jsonResponse(
          {
            ok: false,
            error: "Not found"
          },
          404
        );
      }

      if (
        request.method !== "POST"
      ) {
        return jsonResponse(
          {
            ok: false,
            error: "Method not allowed"
          },
          405
        );
      }

      if (
        !checkActionAuth(
          request,
          env
        )
      ) {
        return unauthorized();
      }

      const body =
        await readJsonBody(
          request
        );

      if (path === "/search") {
        return await handleSearch(
          env,
          body,
          normalizeView(
            body.view
          )
        );
      }

      if (path === "/search-works") {
        return await handleSearch(
          env,
          body,
          "works"
        );
      }

      if (path === "/read") {
        const fileId =
          String(
            body.fileId || ""
          ).trim();

        const query =
          String(
            body.query || ""
          ).trim();

        if (
          !fileId ||
          !query
        ) {
          return jsonResponse(
            {
              ok: false,
              error:
                "Missing fileId or query."
            },
            400
          );
        }

        const result =
          await appsScriptCall(
            env,
            "read",
            {
              fileId,
              query,
              maxExcerpts:
                clampReadMax(
                  body.maxExcerpts
                )
            }
          );

        return jsonResponse(
          result
        );
      }

      if (path === "/works") {
        return await handleList(
          env,
          body,
          "works"
        );
      }

      return await handleList(
        env,
        body,
        normalizeView(
          body.view
        )
      );

    } catch (error) {
      console.error(
        "Teolodzhia Worker error:",
        error
      );

      return jsonResponse(
        {
          ok: false,
          error:
            String(
              error &&
              error.message
                ? error.message
                : error
            )
        },
        500
      );
    }
  }
};
