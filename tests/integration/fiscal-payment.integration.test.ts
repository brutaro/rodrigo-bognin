import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres,{type Sql} from 'postgres';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {saveInvoicePayment,readInvoiceCash} from '../../src/lib/fiscal-payment-repository';
import {readCashProject} from '../../src/lib/cash-repository';
let app:Sql,admin:Sql;
vi.mock('../../src/lib/database',()=>({getSql:()=>app}));
const prefix=`payment-${randomUUID()}`,project=`${prefix}-project`,note=`${prefix}-note`,batch=randomUUID();
const input={id:note,revision:'0',status:'confirmado' as const,projectId:project,paidOn:null,paymentEntryId:null,separatePayment:false,reason:'Declaração sintética do proprietário'};
beforeAll(async()=>{
 if(process.env.TRIA_INTEGRATION_ISOLATED!=='confirmed'||process.env.TRIA_INTEGRATION_NAMESPACE!=='tria-project-import-test'||process.env.TRIA_RUNTIME==='railway')throw Error('Somente ambiente descartável tria-project-import-test.');
 const options={host:process.env.PGHOST??'db',port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE??'tria',prepare:false,max:3};
 const secret=async(path:string|undefined)=>{if(!path)throw Error('Segredo de teste ausente.');return(await readFile(path,'utf8')).trim();};
 app=postgres({...options,username:'tria_app',password:await secret(process.env.TRIA_APP_PASSWORD_FILE)});
 const [marker]=await app`SELECT namespace FROM runtime_instance_marker WHERE singleton`;
 if(marker?.namespace!=='tria-project-import-test')throw Error('Banco fora do namespace descartável.');
 admin=postgres({...options,username:'tria_admin',password:await secret(process.env.TRIA_ADMIN_PASSWORD_FILE)});
 await admin`INSERT INTO import_batch(id,source_type,relative_path,sha256,row_count,status) VALUES(${batch},'fiscal_notes','synthetic-payments',${randomUUID().replaceAll('-','').repeat(2)},1,'completed')`;
 await admin`INSERT INTO project(id,source_project_id,title,evidence_status,import_batch_id) VALUES(${project},${project},'Projeto fiscal sintético','Não informado',${batch})`;
 await admin`INSERT INTO project_draft(project_id,revision) VALUES(${project},0)`;
 await admin`INSERT INTO fiscal_note(id,batch_id,source_note_id,issue_year,note_number,issue_date,amount,declared_project_id) VALUES(${note},${batch},'synthetic',2025,${note},'2025-01-01',827.13,${project})`;
});
afterAll(async()=>{await Promise.all([app?.end({timeout:2}),admin?.end({timeout:2})]);});
it('declara uma saída vinculada à NF, sem inventar data, e preserva a fonte',async()=>{
 await saveInvoicePayment(input);
 const cash=await readCashProject(app,project);
 expect(cash.result.paidCents).toBe('82713');expect(cash.result.resultCents).toBeNull();
 expect(cash.entries).toHaveLength(1);expect(cash.entries[0].fiscalNoteId).toBe(note);expect(cash.entries[0].confirmation?.effectiveOn).toBeNull();
 expect(await app`SELECT amount::text FROM fiscal_note WHERE id=${note}`).toEqual([{amount:'827.13'}]);
});
it('recusa repetição obsoleta, não cria pagamentos manuais e mantém histórico',async()=>{
 await expect(saveInvoicePayment(input)).rejects.toThrow(/mudou/);
 expect(await app`SELECT count(*)::int n FROM fiscal_payment_declaration WHERE fiscal_note_id=${note}`).toEqual([{n:1}]);
 expect(await app`SELECT count(*)::int n FROM manual_financial_entry WHERE project_id=${project}`).toEqual([{n:0}]);
 await expect(app`DELETE FROM fiscal_payment_declaration WHERE fiscal_note_id=${note}`).rejects.toMatchObject({code:'42501'});
});
it('aceita data conhecida sem usar emissão, e reverte em nova revisão',async()=>{
 await saveInvoicePayment({...input,revision:'1',paidOn:'2025-01-03'});
 let cash=await readCashProject(app,project);expect(cash.entries[0].confirmation?.effectiveOn).toBe('2025-01-03');
 await saveInvoicePayment({...input,revision:'2',status:'revertido',reason:'Reversão sintética'});
 cash=await readCashProject(app,project);expect(cash.entries).toHaveLength(0);expect(cash.result.paidCents).toBeNull();
 const current=(await readInvoiceCash(app)).notes.find(n=>n.id===note);expect(current?.declaration?.status).toBe('revertido');
 expect(await app`SELECT count(*)::int n FROM fiscal_payment_declaration WHERE fiscal_note_id=${note}`).toEqual([{n:3}]);
});
