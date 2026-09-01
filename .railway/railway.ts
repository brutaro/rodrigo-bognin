import { defineRailway, group, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const region = "us-east4-eqdc4a";
  const database = postgres("postgres", { region });
  const vault = volume("tria-file-vault", { region, sizeMB: 5_000 });
  const app = service("tria", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    replicas: { [region]: 1 },
    volumeMounts: { "/data/files": vault },
    env: {
      TRIA_RUNTIME: "railway",
      TRIA_INSTANCE_NAMESPACE: "tria-production",
      TRIA_TRUST_PROXY: "enabled",
      TRIA_PUBLIC_HOSTS: preserve(),
      TRIA_DEMO_WRITES: "enabled",
      PGHOST: database.env.PGHOST,
      PGPORT: database.env.PGPORT,
      PGDATABASE: database.env.PGDATABASE,
      TRIA_BOOTSTRAP_MODE: preserve(),
      TRIA_MAINTENANCE_MODE: preserve(),
      TRIA_DB_APP_PASSWORD: preserve(),
      TRIA_DB_MIGRATOR_PASSWORD: preserve(),
      TRIA_LOGIN_CODE: preserve(),
      TRIA_SESSION_KEY: preserve(),
      TRIA_FILE_STORE_UUID: preserve(),
    },
  });
  app.deploy = {
    ...app.deploy,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 3,
    requiredMountPath: "/data/files",
    overlapSeconds: 0,
  };

  return project("rodrigo-bognin", {
    environments: ["production"],
    resources: [group("Persistência privada", [database, vault]), app],
  });
});
