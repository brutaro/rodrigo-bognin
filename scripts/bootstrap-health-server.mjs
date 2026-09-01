import http from "node:http";

if (process.env.TRIA_BOOTSTRAP_MODE !== "enabled" || (process.env.TRIA_PUBLIC_HOSTS ?? "").trim()) {
  throw new Error("Servidor bootstrap recusado: modo exato e ausência de host público são obrigatórios.");
}
const port = Number(process.env.PORT ?? 3000);
const server = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/health" && request.method === "GET") {
    const privilegedNames = ["TRIA_DATABASE_ADMIN_URL", "TRIA_DB_ADMIN_PASSWORD", "TRIA_DB_MIGRATOR_PASSWORD", "TRIA_DB_IMPORTER_PASSWORD", "TRIA_ROTATE_DB_ROLE_PASSWORDS",
      "TRIA_DATABASE_ADMIN_URL_FILE", "TRIA_DB_ADMIN_PASSWORD_FILE", "TRIA_DB_MIGRATOR_PASSWORD_FILE", "TRIA_DB_IMPORTER_PASSWORD_FILE"];
    response.statusCode = 200; response.end(JSON.stringify({ status: "bootstrap", release: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
      uid: process.getuid?.(), gid: process.getgid?.(), privilegedEnvironmentPresent: privilegedNames.some((name) => process.env[name] !== undefined) })); return;
  }
  response.statusCode = 503; response.end(JSON.stringify({ status: "bootstrap-only" }));
});
server.listen(port, "0.0.0.0", () => console.log(`Bootstrap fail-closed ativo na porta ${port}.`));
