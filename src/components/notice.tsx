const messages: Record<string, { tone: string; text: string }> = {
  "narrative-saved": { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", text: "Narrativa salva no ambiente demonstrativo." },
  "financial-entry-saved": { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", text: "Valor registrado sem alterar as referências importadas." },
  "invalid-narrative": { tone: "border-red-200 bg-red-50 text-red-900", text: "Revise a narrativa. Ela deve ter entre 10 e 20.000 caracteres." },
  "invalid-financial-entry": { tone: "border-red-200 bg-red-50 text-red-900", text: "Revise o tipo, a descrição, o valor e a origem do registro." },
  "writes-disabled": { tone: "border-amber-200 bg-amber-50 text-amber-900", text: "A edição demonstrativa não está habilitada neste ambiente." },
};

export function Notice({ code }: { code?: string }) {
  if (!code || !messages[code]) return null;
  const notice = messages[code];
  return <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${notice.tone}`}>{notice.text}</p>;
}
