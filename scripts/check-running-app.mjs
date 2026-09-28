import net from "node:net";

const APP_ID = "gn-planer-app-planner-2";
const [baseUrl, expectedBuildId, expectedPublicUrl] = process.argv.slice(2);

if (!baseUrl || !expectedBuildId || !expectedPublicUrl) {
  process.exitCode = 40;
} else {
  process.exitCode = await checkRunningApp();
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function portAcceptsConnections(value) {
  const url = new URL(value);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: url.hostname, port });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(800, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function looksLikeLegacyPlanner(value) {
  try {
    const [healthResponse, pageResponse] = await Promise.all([
      fetch(new URL("/api/health", value), {
        headers: { accept: "application/json", connection: "close" },
        signal: AbortSignal.timeout(2_000)
      }),
      fetch(new URL("/", value), {
        headers: { accept: "text/html", connection: "close" },
        signal: AbortSignal.timeout(2_000)
      })
    ]);
    if (!healthResponse.ok || !pageResponse.ok) return false;

    const [health, page] = await Promise.all([healthResponse.json(), pageResponse.text()]);
    return health?.status === "ok" && /<title>\s*GN-Planer\s*<\/title>/i.test(page);
  } catch {
    return false;
  }
}

async function checkRunningApp() {
  let response;
  try {
    response = await fetch(new URL("/api/launcher-status", baseUrl), {
      headers: { accept: "application/json", connection: "close" },
      signal: AbortSignal.timeout(2_000)
    });
  } catch {
    return (await portAcceptsConnections(baseUrl)) ? 30 : 0;
  }

  if (!response.ok) {
    // Auf dem Port antwortet etwas, aber es bietet den eindeutigen
    // GN-Planer-Status nicht an. Deshalb darf der Starter nichts beenden.
    await response.body?.cancel();
    return (await looksLikeLegacyPlanner(baseUrl)) ? 20 : 30;
  }

  let status;
  try {
    status = await response.json();
  } catch {
    return 30;
  }

  if (status?.appId !== APP_ID) return 30;

  const sameBuild = status.buildId === expectedBuildId;
  const sameAddress = originOf(status.publicUrl) === originOf(expectedPublicUrl);
  return sameBuild && sameAddress ? 10 : 20;
}
