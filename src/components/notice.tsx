const messages: Record<string, { tone: string; text: string }> = {
  "published": { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", text: "Publicação demonstrativa criada. Esta versão agora é imutável." },
  "already-published": { tone: "border-blue-200 bg-blue-50 text-blue-900", text: "Esta mesma composição já estava publicada. Nenhuma versão duplicada foi criada." },
  "publication-invalid-narrative": { tone: "border-red-200 bg-red-50 text-red-900", text: "A narrativa precisa ter pelo menos 20 caracteres para publicação." },
  "publication-stale-review": { tone: "border-amber-200 bg-amber-50 text-amber-900", text: "O rascunho mudou depois da conferência. Revise a composição novamente antes de publicar." },
  "publication-ack-required": { tone: "border-red-200 bg-red-50 text-red-900", text: "Confirme que conferiu a composição e entendeu os alertas antes de publicar." },
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
