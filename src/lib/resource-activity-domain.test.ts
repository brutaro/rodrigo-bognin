import {describe,it,expect} from 'vitest';
import {activitySeconds,activityValues} from './resource-activity-domain';
describe('Atividades da planilha',()=>{
 it('converte horas decimais em segundos sem perder zero ou ausência',()=>{
  expect(activitySeconds('')).toBeNull();expect(activitySeconds('0')).toBe('0');
  expect(activitySeconds('1,5')).toBe('5400');expect(activitySeconds('0.0002777777777778')).toBe('1');
  expect(()=>activitySeconds('-1')).toThrow();expect(()=>activitySeconds('99999999999999')).not.toThrow();
 });
 it('exige descrição e preserva medições negativas e boletim',()=>{
  const row={id:'N1',project:'P',date:'',activity:'Entrega',hours:'2',amount:'-15.0000000000000001',nature:'',bm:'BM-10'};
  expect(activityValues(row)).toEqual({description:'Entrega',seconds:'7200',amount:row.amount,date:null,bm:'BM-10'});
  expect(()=>activityValues({...row,activity:''})).toThrow('preencha Atividade');
 });
});
