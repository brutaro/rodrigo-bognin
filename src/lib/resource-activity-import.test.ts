import {beforeEach,it,expect,vi} from 'vitest';
import {prepareResourceActivities} from './resource-activity-import';
import type {ResourceRow} from './resource-import-domain';
const state=vi.hoisted(()=>({owner:'original'}));
vi.mock('./database',()=>({getSql:()=>async(parts:TemplateStringsArray)=>{
 const query=parts.join('');
 if(query.includes('FROM project'))return [
  {id:'original',title:'serviços Alfa',source_title:'Tributos Alfa'},
  {id:'replaced',title:'serviços Alfa - cadastro substituído',source_title:'serviços Alfa'},
 ];
 if(query.includes('FROM resource_activity_state'))return [{resource_id:'SYN-1',activity_id:'existing',latest_import_id:'prior',project_id:state.owner,description:'Anterior',seconds:'0',amount:'0',date:'2025-01-02',bm:null,adjusted:true}];
 return [];
}}));
const row:ResourceRow={id:'SYN-1',project:'serviços Alfa',date:'2025-01-02',activity:'Serviços',amount:'15.00',hours:'0',nature:''};
beforeEach(()=>{state.owner='original';});
it('atualiza a mesma atividade no projeto renomeado preservando o ID e os ajustes',async()=>{
 const plan=await prepareResourceActivities([row],new Map([['SYN-1',12]]));
 expect(plan).toMatchObject({added:0,updated:1,adjusted:1});
 expect(plan.items[0]).toMatchObject({activityId:'existing',projectId:'original',resourceId:'SYN-1',expectedImport:'prior',sourceRow:12});
});
it('continua bloqueando a transferência real de atividade entre projetos',async()=>{
 state.owner='unrelated';
 await expect(prepareResourceActivities([row],new Map([['SYN-1',12]]))).rejects.toThrow(/pertence a outro projeto/);
});
