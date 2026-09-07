import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),read:vi.fn(),extract:vi.fn()}));
vi.mock('@/lib/auth',()=>({apiAuthenticationStatus:mocks.auth,assertSameOrigin:mocks.origin}));
vi.mock('@/lib/fiscal-pdf',()=>({readFiscalPdf:mocks.read}));
vi.mock('@/lib/fiscal-pdf-text',()=>({extractFiscalPdfText:mocks.extract}));
import {POST} from './route';
const request=()=>new Request('http://localhost/api/sources/fiscal-pdf/00000000-0000-4000-8000-000000000001/suggestions',{method:'POST'});
const params={params:Promise.resolve({id:'00000000-0000-4000-8000-000000000001'})};
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue('authenticated');mocks.read.mockResolvedValue({bytes:new Uint8Array([1])});mocks.extract.mockResolvedValue({pages:['Número da nota: 123\nDado privado que não deve sair na resposta']});});
it('recusa sem sessão e origem inválida antes de ler',async()=>{
 mocks.auth.mockResolvedValue('anonymous');expect((await POST(request(),params)).status).toBe(401);expect(mocks.read).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue('authenticated');mocks.origin.mockRejectedValue(new Error('Origem inválida'));expect((await POST(request(),params)).status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();
});
it('retorna apenas sugestões e trechos com cache privado',async()=>{
 const result=await POST(request(),params);expect(result.headers.get('cache-control')).toBe('private, no-store');const body=await result.json();expect(body.suggestions.number.value).toBe('123');expect(JSON.stringify(body)).not.toContain('Dado privado');
});
it('não expõe falhas internas de integridade e permite fallback da leitura',async()=>{
 mocks.read.mockRejectedValueOnce(new Error('secret object key'));let result=await POST(request(),params);expect(result.status).toBe(400);expect(await result.text()).not.toContain('secret');expect(mocks.extract).not.toHaveBeenCalled();
 mocks.extract.mockResolvedValue({pages:[],warning:'Preencha manualmente.'});result=await POST(request(),params);expect(await result.json()).toEqual({suggestions:{},warnings:['Preencha manualmente.']});
});
