import { database, defineRailway, group, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const region = "us-east4-eqdc4a";
  const databaseVolume = volume("tria-postgres-data", { region, sizeMB: 5_000 });
  const databaseService = database("postgres16", "postgres", {
    image: "ghcr.io/railwayapp-templates/postgres-ssl@sha256:ed2017fa2ed460130a9789180f838ebccb9122267f43910b4bf42a72f99a3486",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region,
  });

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
      PGHOST: databaseService.env.RAILWAY_PRIVATE_DOMAIN,
      PGPORT: "5432",
      PGDATABASE: "tria",
      TRIA_BOOTSTRAP_MODE: preserve(),
      TRIA_MAINTENANCE_MODE: preserve(),
      TRIA_DATABASE_ADMIN_URL: preserve(),
      TRIA_DB_ADMIN_PASSWORD: preserve(),
      TRIA_DB_APP_PASSWORD: preserve(),
      TRIA_DB_IMPORTER_PASSWORD: preserve(),
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
    resources: [group("Persistência privada", [databaseService, databaseVolume, vault]), app],
  });
});
