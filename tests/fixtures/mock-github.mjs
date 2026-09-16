// Subprocess CLI tests must never reach GitHub, even with real credentials in
// the parent environment. Unexpected requests fail instead of using the network.
globalThis.fetch = async (url, options) => {
  const pathname = new URL(url).pathname;
  const method = options?.method ?? "GET";
  if (method === "GET" && pathname.includes("/releases/tags/")) {
    return Response.json({ message: "Not Found" }, { status: 404 });
  }
  if (method === "POST" && pathname.endsWith("/releases")) {
    const { tag_name } = JSON.parse(options.body);
    return Response.json({
      html_url: `https://example.test/releases/${tag_name}`,
    });
  }
  if (method === "GET" && pathname.endsWith("/pulls")) {
    return Response.json([]);
  }
  if (method === "POST" && pathname.endsWith("/pulls")) {
    return Response.json({
      id: 1,
      number: 1,
      state: "open",
      html_url: "https://example.test/pull/1",
    });
  }
  if (method === "POST" && pathname.endsWith("/labels")) {
    return Response.json([]);
  }
  throw new Error(`Unexpected GitHub request: ${method} ${url}`);
};
