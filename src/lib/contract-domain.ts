import {z} from 'zod';
import {cashMoney} from './cash-domain';
const cents=z.string().regex(/^\d{1,15}$/).transform(value=>BigInt(value).toString());
export const contractInput=z.object({
 revision:z.string().regex(/^\d{1,15}$/),totalCents:cents,reference:z.string().trim().min(3).max(200),reason:z.string().trim().min(3).max(500),
 receipts:z.array(z.object({id:z.uuid(),amountCents:cents.refine(value=>BigInt(value)>0n),receivedOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value),reference:z.string().trim().min(3).max(200),voided:z.boolean()})).max(200),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.receipts.map(r=>r.id)).size!==value.receipts.length)ctx.addIssue({code:'custom',message:'Recebimento repetido.'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(value.receipts.some(r=>r.receivedOn>today))ctx.addIssue({code:'custom',message:'Recebimentos exigem data passada ou de hoje.'});
});
export type Contract=Omit<z.infer<typeof contractInput>,'reason'>&{updatedAt:string;reason:string};
export function contractMetrics(contract:Contract){
 const received=contract.receipts.filter(r=>!r.voided).reduce((sum,r)=>sum+BigInt(r.amountCents),0n),balance=BigInt(contract.totalCents)-received;
 return [{name:'Valor contratado',value:cashMoney(contract.totalCents)}, {name:'Recebido do contrato',value:cashMoney(received.toString())},{name:balance<0n?'Recebido acima do contratado':'Saldo contratual a receber',value:cashMoney((balance<0n?-balance:balance).toString())}];
}
