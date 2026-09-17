import {beforeEach,it,expect,vi} from 'vitest';
import {POST} from './route';
const state=vi.hoisted(()=>({authenticated:true,origin:true,save:vi.fn(),bulk:vi.fn()}));
vi.mock('@/lib/auth',()=>({apiAuthenticationStatus:async()=>state.authenticated?'authenticated':'unauthenticated',assertSameOrigin:async()=>{if(!state.origin)throw Error('origin');}}));
vi.mock('@/lib/fiscal-payment-repository',()=>({saveInvoicePayment:state.save,confirmInvoicePayments:state.bulk,FiscalPaymentError:class extends Error{}}));
const input={operation:'save',id:'synthetic',revision:'0',status:'confirmado',projectId:null,paidOn:null,paymentEntryId:null,separatePayment:false,reason:'Declaração do proprietário'};
const request=(body:unknown)=>new Request('http://localhost/api/fiscal-payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();state.authenticated=true;state.origin=true;vi.stubEnv('TRIA_DEMO_WRITES','enabled');});
it('permite declaração com data desconhecida e motivo explícito',async()=>{expect((await POST(request(input))).status).toBe(200);expect(state.save).toHaveBeenCalledWith(input);});
it('bloqueia sessão ausente, origem externa e gravação desativada',async()=>{
 state.authenticated=false;expect((await POST(request(input))).status).toBe(401);state.authenticated=true;state.origin=false;expect((await POST(request(input))).status).toBe(400);state.origin=true;vi.stubEnv('TRIA_DEMO_WRITES','disabled');expect((await POST(request(input))).status).toBe(403);expect(state.save).not.toHaveBeenCalled();
});
it('recusa data inválida, motivo vazio e revisões inválidas',async()=>{
 for(const change of [{paidOn:'2025-02-30'},{reason:''},{revision:'-1'},{paymentEntryId:'bad'}])expect((await POST(request({...input,...change}))).status).toBe(400);
 expect(state.save).not.toHaveBeenCalled();
});
it('exige confirmação explícita e hash para lote',async()=>{
 const body={operation:'confirm-all',basisHash:'a'.repeat(64),reason:'Confirmo os pagamentos',confirmed:true};
 expect((await POST(request({...body,confirmed:false}))).status).toBe(400);expect(state.bulk).not.toHaveBeenCalled();
 expect((await POST(request(body))).status).toBe(200);expect(state.bulk).toHaveBeenCalledWith(body.basisHash,body.reason);
});
