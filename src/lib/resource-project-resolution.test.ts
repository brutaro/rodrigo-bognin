import {describe,it,expect} from 'vitest';
import {matchingResourceProjects,resourceProjectTitles} from './resource-project-resolution';
import {mergeProjectResources,type ResourceRow} from './resource-import-domain';
const original={id:'original',title:'serviços Alfa',source_title:'Tributos Alfa'};
const replaced={id:'replaced',title:'serviços Alfa - cadastro substituído',source_title:'serviços Alfa'};
describe('identidade do projeto após renomeação',()=>{
 it('prefere o nome vigente ao apelido histórico de outro cadastro',()=>{
  expect(matchingResourceProjects([replaced,original],'serviços Alfa')).toEqual([original]);
  expect(matchingResourceProjects([original,replaced],'Tributos Alfa')).toEqual([original]);
  expect(resourceProjectTitles([original,replaced],original.id)).toEqual(['serviços Alfa','Tributos Alfa']);
  expect(resourceProjectTitles([original,replaced],replaced.id)).toEqual([replaced.title]);
 });
 it('não esconde duplicidades de nomes atuais nem de aliases históricos',()=>{
  expect(matchingResourceProjects([original,{...original,id:'other'}],original.title)).toHaveLength(2);
  expect(matchingResourceProjects([original,{...original,id:'other',title:'Outro nome'}],original.source_title)).toHaveLength(2);
 });
 it('substitui o recorte antigo sem duplicar IDs e protege outros projetos',()=>{
  const row:ResourceRow={id:'SYN-1',project:original.source_title,date:'2025-01-01',activity:'Serviços',amount:'15.00',hours:'0',nature:''};
  const next={...row,project:original.title};
  expect(mergeProjectResources([row],[next],original.title,[original.title,original.source_title])).toEqual([next]);
  expect(()=>mergeProjectResources([{...row,project:'Outro'}],[next],original.title,[original.title,original.source_title])).toThrow(/outro projeto/);
 });
});
