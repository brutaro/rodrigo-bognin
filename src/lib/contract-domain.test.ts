import {describe,it,expect} from 'vitest';
import {contractInput,contractMetrics,type Contract} from './contract-domain';
const contract:Contract={revision:'1',totalCents:'100000',reference:'Contrato de teste',reason:'Cadastro de teste',updatedAt:'2026-09-06T00:00:00Z',receipts:[{id:'10000000-0000-4000-8000-000000000001',amountCents:'30001',reference:'Parcela inicial',receivedOn:'2026-09-01',voided:false}]};
describe('saldo contratual declarado',()=>{
 it('calcula parcelas em centavos e exclui recebimento anulado',()=>{
  expect(contractMetrics(contract)[2].value).toBe('R$ 699,99');
  expect(contractMetrics({...contract,receipts:[{...contract.receipts[0],voided:true}]} )[2].value).toBe('R$ 1.000,00');
  expect(contractMetrics({...contract,totalCents:'1'})[2]).toMatchObject({name:'Recebido acima do contratado',value:'R$ 300,00'});
 });
 it('recusa valores inválidos, IDs repetidos e datas impossíveis ou futuras',()=>{
  const {updatedAt:_,...input}=contract;void _;
  expect(contractInput.safeParse(input).success).toBe(true);
  for(const data of [{...input,totalCents:'-1'},{...input,receipts:[...input.receipts,...input.receipts]},...['2099-01-01','2026-02-31'].map(receivedOn=>({...input,receipts:[{...input.receipts[0],receivedOn}]}))])expect(contractInput.safeParse(data).success).toBe(false);
 });
});
