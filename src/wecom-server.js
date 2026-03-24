import http from "node:http";

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

export function createWeComHttpServer({ controller, callbackPath = "/wecom/callback" }) {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (requestUrl.pathname !== callbackPath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    try {
      const rawBody = request.method === "POST" ? await readRawBody(request) : "";
      const result = await controller.handle({
        method: request.method,
        query: Object.fromEntries(requestUrl.searchParams.entries()),
        rawBody
      });

      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message ?? "Internal Server Error");
    }
  });
}

export function startWeComHttpServer({ controller, callbackPath, port = 8787, host = "0.0.0.0" }) {
  const server = createWeComHttpServer({ controller, callbackPath });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}
