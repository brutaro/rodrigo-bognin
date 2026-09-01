import { readFileSync } from "node:fs";

function readRequiredSecret(variable: "TRIA_LOGIN_CODE_FILE" | "TRIA_SESSION_KEY_FILE") {
  const file = process.env[variable];
  if (!file) throw new Error(`Secret obrigatório ausente: ${variable}.`);
  const value = readFileSync(file);
  if (!value.length) throw new Error(`Secret obrigatório vazio: ${variable}.`);
  return value;
}

export function readSessionKey() {
  const key = readRequiredSecret("TRIA_SESSION_KEY_FILE");
  if (key.length < 32) throw new Error("A chave de sessão precisa ter pelo menos 32 bytes.");
  return key;
}

export function readLoginCode() {
  const value = readRequiredSecret("TRIA_LOGIN_CODE_FILE").toString("utf8").trim();
  if (value.length < 22) throw new Error("O código permanente precisa ter pelo menos 22 caracteres.");
  return value;
}
