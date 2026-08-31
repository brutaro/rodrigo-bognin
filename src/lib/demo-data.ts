export type ProjectStatus = "Em trabalho" | "Pronto para revisar" | "Publicado";

export type Project = {
  id: string;
  name: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: ProjectStatus;
  narrative: string;
  activities: Array<{
    id: string;
    description: string;
    bm: string;
    hours: string;
    measuredValue: string;
  }>;
  financialReferences: Array<{
    id: string;
    kind: "NFS-e" | "Informação de Rodrigo" | "Referência financeira";
    label: string;
    amount: string;
    relatedAmount?: string | null;
    fullValueEligible?: boolean | null;
    relationBasis?: "Declarado na fonte" | "Candidato auditado" | "Sem vínculo de projeto";
    relation: "Forte" | "Média" | "Fraca" | "Sem relação confirmada";
    payment: "Não informado" | "Informado" | "Com comprovante";
  }>;
  evidence: Array<{
    id: string;
    name: string;
    kind: string;
    availability: "Disponível" | "Pendente";
  }>;
};

// Dados inteiramente fictícios. Nenhum nome, valor ou documento de Rodrigo é usado nesta fase.
export const demoProjects: Project[] = [
  {
    id: "demonstracao-continuidade",
    name: "Projeto demonstrativo — continuidade operacional",
    period: "06/2024 a 11/2025",
    periodStart: "2024-06-01",
    periodEnd: "2025-11-30",
    status: "Pronto para revisar",
    narrative:
      "Conduzi o acompanhamento das atividades e organizei as evidências para tornar o histórico do projeto fácil de consultar. Este texto é fictício e serve somente para validar a experiência de edição.",
    activities: [
      {
        id: "ATV-DEMO-001",
        description: "Organização do plano de trabalho",
        bm: "BM 01",
        hours: "12:30",
        measuredValue: "R$ 1.125,00",
      },
      {
        id: "ATV-DEMO-002",
        description: "Consolidação das evidências",
        bm: "BM 02",
        hours: "08:00",
        measuredValue: "R$ 720,00",
      },
    ],
    financialReferences: [
      {
        id: "REF-DEMO-001",
        kind: "NFS-e",
        label: "NFS-e demonstrativa 001",
        amount: "R$ 1.500,00",
        relation: "Média",
        payment: "Não informado",
      },
      {
        id: "REF-DEMO-002",
        kind: "Informação de Rodrigo",
        label: "Pagamento informado para demonstração",
        amount: "R$ 345,00",
        relation: "Sem relação confirmada",
        payment: "Informado",
      },
    ],
    evidence: [
      {
        id: "EVD-DEMO-001",
        name: "Relatório demonstrativo.pdf",
        kind: "Relatório",
        availability: "Disponível",
      },
      {
        id: "EVD-DEMO-002",
        name: "Registro de reunião demonstrativo.docx",
        kind: "Documento",
        availability: "Pendente",
      },
    ],
  },
  {
    id: "demonstracao-processos",
    name: "Projeto demonstrativo — melhoria de processos",
    period: "01/2025 a 08/2025",
    periodStart: "2025-01-01",
    periodEnd: "2025-08-31",
    status: "Em trabalho",
    narrative:
      "Mapeei o processo atual, identifiquei pontos de atenção e organizei uma proposta de melhoria. Conteúdo fictício.",
    activities: [
      {
        id: "ATV-DEMO-003",
        description: "Mapeamento do processo atual",
        bm: "BM 03",
        hours: "16:00",
        measuredValue: "R$ 1.440,00",
      },
    ],
    financialReferences: [
      {
        id: "REF-DEMO-003",
        kind: "Referência financeira",
        label: "Referência ainda não conciliada",
        amount: "R$ 980,00",
        relation: "Fraca",
        payment: "Não informado",
      },
    ],
    evidence: [
      {
        id: "EVD-DEMO-003",
        name: "Mapa demonstrativo.xlsx",
        kind: "Planilha",
        availability: "Disponível",
      },
    ],
  },
  {
    id: "demonstracao-comunicacao",
    name: "Projeto demonstrativo — comunicação interna",
    period: "03/2025 a 10/2025",
    periodStart: "2025-03-01",
    periodEnd: "2025-10-31",
    status: "Publicado",
    narrative:
      "Estruturei uma comunicação clara para apoiar as equipes durante uma mudança interna. Conteúdo fictício.",
    activities: [
      {
        id: "ATV-DEMO-004",
        description: "Preparação da comunicação",
        bm: "BM 04",
        hours: "06:30",
        measuredValue: "R$ 585,00",
      },
    ],
    financialReferences: [],
    evidence: [
      {
        id: "EVD-DEMO-004",
        name: "Comunicado demonstrativo.pdf",
        kind: "Publicação",
        availability: "Disponível",
      },
    ],
  },
];

export function getDemoProject(id: string) {
  return demoProjects.find((project) => project.id === id);
}
