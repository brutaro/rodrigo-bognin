import { decimal, type ResourceRow } from './resource-import-domain';
export function activitySeconds(hours: string): string | null {
  if (!hours) return null;
  const value=decimal(hours);
  if(value.startsWith('-')) throw Error('Horas de atividade não podem ser negativas.');
  const [integer,fraction='']=value.split('.');
  const scale=10n**16n;
  const seconds=((BigInt(integer)*scale+BigInt(fraction.padEnd(16,'0')))*3600n+scale/2n)/scale;
  if(seconds>9223372036854775807n) throw Error('Quantidade de horas fora do limite.');
  return seconds.toString();
}
export function activityValues(row: ResourceRow) {
  if(!row.activity.trim()) throw Error(`ID ${row.id}: preencha Atividade para criar a medição.`);
  if((row.bm?.length ?? 0)>200) throw Error(`ID ${row.id}: Boletim muito longo.`);
  return {description:row.activity,seconds:activitySeconds(row.hours),amount:row.amount,date:row.date || null,bm:row.bm || 'Não informado'};
}
