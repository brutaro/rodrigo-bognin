import {describe,it,expect} from 'vitest';
import {planResourceProjects,type ResourceProject} from './resource-project-import';
import type {ResourceRow} from './resource-import-domain';
const project=(id:string,title:string):ResourceProject=>({id,title,source_title:title,revision:'0',archived:false,start:null,end:null});
const row=(name:string):ResourceRow=>({id:name,project:name,date:'',activity:'Atividade',amount:'0',hours:'0',nature:''});
describe('projetos da carga',()=>{
 it('preserva o projeto original renomeado sem reativar o cadastro substituído',()=>{
  const original={...project('original','serviços Alfa'),source_title:'Tributos Alfa'};
  const replaced={...project('replaced','serviços Alfa - cadastro substituído'),source_title:'serviços Alfa',archived:true};
  const plan=planResourceProjects([original,replaced],[row('serviços Alfa')],[row('Tributos Alfa')],true);
  expect(plan.create).toEqual([]);expect(plan.restore).toEqual([]);expect(plan.archive).toEqual([]);
 });
 it('planeja novos projetos sem alterar o catálogo e reaproveita os IDs da prévia',()=>{
  const projects=[project('A','Projeto A')];const plan=planResourceProjects(projects,[row('Projeto novo')],[],false);
  expect(projects).toHaveLength(1);expect(plan.create).toHaveLength(1);expect(plan.archive).toEqual([]);
  expect(planResourceProjects(projects,[row('Projeto novo')],[],false,plan.create).create).toEqual(plan.create);
 });
 it('arquiva ausentes somente na sobrescrita e somente projetos da base anterior',()=>{
  const projects=[project('A','Projeto A'),project('B','Projeto B'),project('C','Cadastro independente')];
  const previous=[row('Projeto A'),row('Projeto B')],next=[row('Projeto A')];
  expect(planResourceProjects(projects,next,previous,false).archive).toEqual([]);
  expect(planResourceProjects(projects,next,previous,true).archive.map(p=>p.id)).toEqual(['B']);
 });
 it('não reativa projeto arquivado ausente de uma carga complementar',()=>{
  const archived={...project('A','Projeto A'),archived:true};
  const plan=planResourceProjects([archived],[row('Projeto A'),row('Projeto Novo')],[row('Projeto A')],false,[],['Projeto Novo']);
  expect(plan.restore).toEqual([]);
 });
 it('recusa nomes ambíguos e reativa o mesmo projeto se ele reaparecer',()=>{
  expect(()=>planResourceProjects([project('A','Mesmo nome'),project('B','Mesmo nome')],[row('Mesmo nome')],[],true)).toThrow(/ambíguo/);
  const archived={...project('A','Projeto A'),archived:true};const plan=planResourceProjects([archived],[row('Projeto A')],[],true);
  expect(plan.create).toEqual([]);expect(plan.restore).toEqual([archived]);
 });
});
