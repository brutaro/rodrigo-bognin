#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

function usage() {
  console.error("Uso: node scripts/restore-file-backup.mjs --verify-only <bundle.zip> | --target <diretório-novo> <bundle.zip>");
  process.exit(2);
}

const args = process.argv.slice(2);
let target = null;
let bundle = null;
if (args[0] === "--verify-only" && args.length === 2) { bundle = args[1]; }
else if (args[0] === "--target" && args.length === 3) { target = path.resolve(args[1]); bundle = args[2]; }
else usage();

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip)));
}
function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { zip.off("entry", entry); zip.off("end", end); zip.off("error", reject); };
    const entry = (value) => { cleanup(); resolve(value); };
    const end = () => { cleanup(); resolve(null); };
    zip.once("entry", entry); zip.once("end", end); zip.once("error", reject); zip.readEntry();
  });
}
function entryStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}
async function entryBuffer(zip, entry, limit = 64 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of await entryStream(zip, entry)) {
    size += chunk.length; if (size > limit) throw new Error("Entrada de metadados excede o limite."); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function validObjectPath(value) { return /^objects\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
async function syncPath(value) { const handle = await open(value, "r"); try { await handle.sync(); } finally { await handle.close(); } }

function exactRows(rows, keys, expected) {
  if (!Array.isArray(rows)) return false;
  const actual = rows.map((row) => keys.map((key) => String(row?.[key])).join("|")).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((value, index) => value === wanted[index]);
}
function canonicalAccessControl(access) {
  const observed = access?.observed;
  const tableOwners = observed?.tableOwners;
  const databaseName = observed?.databaseAcl?.[0]?.object_name;
  const legacyTable = [
    "file_document|tria_app|INSERT|false", "file_document|tria_app|SELECT|false",
    "file_operation_event|tria_app|INSERT|false", "file_operation_event|tria_app|SELECT|false",
    "file_reservation|tria_app|DELETE|false", "file_reservation|tria_app|INSERT|false", "file_reservation|tria_app|SELECT|false",
    "file_store_counter|tria_app|SELECT|false", "file_version|tria_app|INSERT|false", "file_version|tria_app|SELECT|false",
    "publication|tria_app|INSERT|false", "publication|tria_app|SELECT|false",
    "publication_file|tria_app|INSERT|false", "publication_file|tria_app|SELECT|false",
  ];
  const currentTable = legacyTable.filter((row) => !row.startsWith("file_document|tria_app|INSERT") && !row.startsWith("file_version|tria_app|INSERT"));
  const updates = [
    "file_document|include_in_publication|tria_app|UPDATE|false", "file_document|status|tria_app|UPDATE|false",
    "file_document|title|tria_app|UPDATE|false", "file_document|updated_at|tria_app|UPDATE|false",
    "file_reservation|status|tria_app|UPDATE|false", "file_store_counter|reserved_bytes|tria_app|UPDATE|false",
    "file_store_counter|used_bytes|tria_app|UPDATE|false", "file_store_counter|volume_uuid|tria_app|UPDATE|false",
    "file_version|status|tria_app|UPDATE|false",
  ];
  const inserts = [
    "file_document|created_at|tria_app|INSERT|false", "file_document|id|tria_app|INSERT|false",
    "file_document|include_in_publication|tria_app|INSERT|false", "file_document|project_id|tria_app|INSERT|false",
    "file_document|status|tria_app|INSERT|false", "file_document|title|tria_app|INSERT|false", "file_document|updated_at|tria_app|INSERT|false",
    "file_version|created_at|tria_app|INSERT|false", "file_version|document_id|tria_app|INSERT|false", "file_version|id|tria_app|INSERT|false",
    "file_version|media_type|tria_app|INSERT|false", "file_version|object_key|tria_app|INSERT|false", "file_version|original_name|tria_app|INSERT|false",
    "file_version|sha256|tria_app|INSERT|false", "file_version|size_bytes|tria_app|INSERT|false", "file_version|status|tria_app|INSERT|false",
    "file_version|version|tria_app|INSERT|false",
  ];
  const tableAclValid = exactRows(observed?.tableAcl, ["object_name", "grantee", "privilege", "grantable"], currentTable) ||
    exactRows(observed?.tableAcl, ["object_name", "grantee", "privilege", "grantable"], legacyTable);
  const columnAclValid = exactRows(observed?.columnAcl, ["object_name", "column_name", "grantee", "privilege", "grantable"], [...inserts, ...updates]) ||
    exactRows(observed?.columnAcl, ["object_name", "column_name", "grantee", "privilege", "grantable"], updates);
  return access?.owner === "Rodrigo" && access?.policy === "owner-only" && access?.runtimeRole === "tria_app" &&
    access?.directPublicationDelete === false && access?.purgeFunction === "complete_file_purge(p_document_id uuid)" &&
    exactRows(tableOwners, ["tablename", "tableowner"], [
      "file_document|tria_migrator", "file_operation_event|tria_migrator", "file_reservation|tria_migrator", "file_store_counter|tria_migrator",
      "file_version|tria_migrator", "publication|tria_migrator", "publication_file|tria_migrator",
    ]) && tableAclValid && columnAclValid &&
    exactRows(observed?.functionAcl, ["object_name", "owner", "security_definer", "configuration", "grantee", "privilege", "grantable"], [
      "complete_file_purge(p_document_id uuid)|tria_migrator|true|search_path=pg_catalog, public|tria_app|EXECUTE|false",
    ]) && exactRows(observed?.schemaAcl, ["object_name", "owner", "grantee", "privilege", "grantable"], [
      "public|pg_database_owner|PUBLIC|USAGE|false", "public|pg_database_owner|tria_migrator|CREATE|false", "public|pg_database_owner|tria_migrator|USAGE|false",
    ]) && typeof databaseName === "string" && exactRows(observed?.databaseAcl, ["object_name", "owner", "grantee", "privilege", "grantable"], [
      `${databaseName}|tria_admin|tria_app|CONNECT|false`, `${databaseName}|tria_admin|tria_importer|CONNECT|false`, `${databaseName}|tria_admin|tria_migrator|CONNECT|false`,
    ]);
}

const evidenceMedia = new Map([
  ["pdf", "application/pdf"], ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"], ["xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], ["mp4", "video/mp4"], ["pbix", "application/octet-stream"],
]);
function normalizeAndValidateShape(model) {
  const explicitDocuments = model.documents.every((item) => item.document_kind === "project" || item.document_kind === "evidence");
  const explicitVersions = model.versions.every((item) => Object.hasOwn(item, "evidence_asset_id"));
  const legacy = !model.documents.some((item) => Object.hasOwn(item, "document_kind")) && !model.versions.some((item) => Object.hasOwn(item, "evidence_asset_id"));
  if (!legacy && (!explicitDocuments || !explicitVersions)) throw new Error("Shape misto do catálogo recusado.");
  const documents = model.documents.map((item) => legacy ? { ...item, document_kind: "project" } : item);
  const versions = model.versions.map((item) => legacy ? { ...item, evidence_asset_id: null } : item);
  for (const document of documents) {
    const owned = versions.filter((item) => item.document_id === document.id);
    if (document.document_kind === "project") {
      if (!document.project_id || owned.some((item) => item.evidence_asset_id !== null)) throw new Error("Shape de documento de projeto inválido.");
    } else {
      if (document.project_id !== null || document.include_in_publication !== false || owned.length !== 1) throw new Error("Shape de documento de evidência inválido.");
      const version = owned[0];
      const match = /^EV-\d{3}\.([a-z0-9]+)$/.exec(version.original_name ?? "");
      const legacySafeName = version.original_name === `evidencia-${version.sha256}` && version.media_type === "application/octet-stream";
      if ((!legacySafeName && (!match || !evidenceMedia.has(match[1]) || evidenceMedia.get(match[1]) !== version.media_type)) || version.version !== 1 ||
          !/^[0-9a-f]{64}$/.test(version.evidence_asset_id ?? "") || version.sha256 !== version.evidence_asset_id) throw new Error("Shape, nome ou mídia da evidência inválido.");
    }
  }
  return { ...model, documents, versions };
}

const zip = await openZip(path.resolve(bundle));
let manifest = null;
let catalog = null;
let catalogModel = null;
const seen = new Set();
const restored = new Set();
let temporary = null;
try {
  if (target) {
    try { await lstat(target); throw new Error("O destino de restauração não pode existir."); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    temporary = `${target}.tria-restore-${randomUUID()}`;
    await mkdir(path.join(temporary, "objects"), { recursive: true, mode: 0o700 });
  }
  for (;;) {
    const entry = await nextEntry(zip); if (!entry) break;
    const name = entry.fileName;
    if (seen.has(name) || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || name.includes("\0")) throw new Error("Caminho ZIP inválido ou duplicado.");
    seen.add(name);
    if (name === "manifest.json") {
      const raw = await entryBuffer(zip, entry); manifest = JSON.parse(raw.toString("utf8"));
      if (manifest.format !== "tria-file-backup-v1" || manifest.catalog?.path !== "catalog.json" || !Array.isArray(manifest.objects) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(manifest.volumeUuid)) throw new Error("Manifesto incompatível.");
      const paths = new Set(); let total = 0;
      for (const object of manifest.objects) {
        if (!validObjectPath(object.path) || paths.has(object.path) || !Number.isSafeInteger(object.sizeBytes) || object.sizeBytes <= 0 ||
            !/^[0-9a-f]{64}$/.test(object.sha256)) throw new Error("Manifesto contém objeto inválido.");
        paths.add(object.path); total += object.sizeBytes;
      }
      if (!Number.isSafeInteger(total) || total > 4_000_000_000) throw new Error("Manifesto excede a quota do cofre.");
      continue;
    }
    if (name === "catalog.json") {
      if (!manifest) throw new Error("Manifesto deve preceder o catálogo.");
      catalog = await entryBuffer(zip, entry);
      if (catalog.length !== manifest.catalog.sizeBytes || digest(catalog) !== manifest.catalog.sha256) throw new Error("Catálogo adulterado.");
      catalogModel = JSON.parse(catalog.toString("utf8"));
      if (catalogModel.format !== "tria-file-catalog-v1" || !canonicalAccessControl(catalogModel.accessControl) ||
          !Array.isArray(catalogModel.documents) || !Array.isArray(catalogModel.versions) || !Array.isArray(catalogModel.publications) ||
          !Array.isArray(catalogModel.publicationLinks) || !catalogModel.quota || typeof catalogModel.quota !== "object") throw new Error("ACL ou catálogo incompatível.");
      catalogModel = normalizeAndValidateShape(catalogModel);
      const declared = new Map(manifest.objects.map((item) => [item.path.slice("objects/".length), item]));
      const documents = new Set(catalogModel.documents.map((item) => item.id));
      const versions = new Set(catalogModel.versions.map((item) => item.id));
      const publications = new Set(catalogModel.publications.map((item) => item.id));
      if (catalogModel.versions.length !== declared.size || documents.size !== catalogModel.documents.length ||
          versions.size !== catalogModel.versions.length || publications.size !== catalogModel.publications.length) throw new Error("Catálogo e manifesto divergem.");
      let catalogBytes = 0;
      for (const version of catalogModel.versions) {
        const object = declared.get(version.object_key);
        if (!documents.has(version.document_id) || !object || String(object.sizeBytes) !== String(version.size_bytes) || object.sha256 !== version.sha256) throw new Error("Catálogo e objeto divergem.");
        catalogBytes += Number(version.size_bytes);
      }
      for (const link of catalogModel.publicationLinks) if (!publications.has(link.publication_id) || !versions.has(link.file_version_id)) throw new Error("Vínculo do catálogo inválido.");
      const quota = catalogModel.quota;
      if (String(catalogBytes) !== String(quota.used_bytes) || quota.reserved_bytes !== "0" || !["4000000000", "9000000000"].includes(quota.quota_bytes) ||
          catalogBytes > 4_000_000_000) throw new Error("Quota do catálogo inválida ou incompatível com Hobby.");
      continue;
    }
    if (!validObjectPath(name) || !manifest || !catalog) throw new Error("Entrada inesperada no bundle.");
    const expected = manifest.objects.find((item) => item.path === name);
    if (!expected || restored.has(name)) throw new Error("Objeto não declarado ou duplicado.");
    if (entry.uncompressedSize !== expected.sizeBytes) throw new Error("Tamanho ZIP diverge do manifesto.");
    const hash = createHash("sha256"); let size = 0;
    const stream = await entryStream(zip, entry);
    if (temporary) {
      const destination = path.join(temporary, name);
      const verifier = async function* () { for await (const chunk of stream) { size += chunk.length; hash.update(chunk); yield chunk; } };
      await pipeline(verifier(), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
      await syncPath(destination);
    } else {
      for await (const chunk of stream) { size += chunk.length; hash.update(chunk); }
    }
    if (size !== expected.sizeBytes || hash.digest("hex") !== expected.sha256) throw new Error("Objeto adulterado.");
    restored.add(name);
  }
  if (!manifest || !catalog || !catalogModel || restored.size !== manifest.objects.length || manifest.objects.some((item) => !restored.has(item.path))) throw new Error("Bundle incompleto.");
  if (temporary && target) {
    await mkdir(path.join(temporary, "staging"), { mode: 0o700 });
    await chmod(path.join(temporary, "objects"), 0o700);
    await writeFile(path.join(temporary, ".tria-volume"), `${manifest.volumeUuid}
`, { mode: 0o600, flag: "wx", flush: true });
    const normalizedCatalog = Buffer.from(`${JSON.stringify({ ...catalogModel, quota: { ...catalogModel.quota, quota_bytes: "4000000000" } }, null, 2)}
`);
    const normalizedManifest = { ...manifest, catalog: { ...manifest.catalog, sizeBytes: normalizedCatalog.length, sha256: digest(normalizedCatalog) } };
    await writeFile(path.join(temporary, "catalog.json"), normalizedCatalog, { mode: 0o600, flag: "wx", flush: true });
    await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify(normalizedManifest, null, 2)}
`, { mode: 0o600, flag: "wx", flush: true });
    await syncPath(path.join(temporary, "objects"));
    await syncPath(path.join(temporary, "staging"));
    await syncPath(temporary);
    try { await lstat(target); throw new Error("O destino apareceu durante a restauração."); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, target);
    await syncPath(path.dirname(target));
    temporary = null;
  }
  console.log(`backup verificado: ${restored.size} objeto(s)`);
} catch (error) {
  if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  console.error(`backup inválido: ${error instanceof Error ? error.message : "falha desconhecida"}`);
  process.exitCode = 1;
} finally {
  zip.close();
}
