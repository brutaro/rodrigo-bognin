import {it,expect} from 'vitest';
import {boundedPdfScale} from './pdf-viewport';
it('limita páginas enormes em resolução e memória, respeitando largura do celular',()=>{
 for(const [width,height,available,ratio] of [[600,800,330,3],[100000,100000,900,2],[10,1000000,900,2]]){
  const scale=boundedPdfScale(width,height,available,ratio);
  expect(width*scale).toBeLessThanOrEqual(2048);expect(height*scale).toBeLessThanOrEqual(2048);
  expect(width*height*scale*scale).toBeLessThanOrEqual(1_500_001);
 }
 expect(boundedPdfScale(600,800,330,3)).toBeCloseTo(1.1);
});
it('recusa dimensões ilegíveis',()=>{for(const width of [0,-1,Infinity,NaN])expect(()=>boundedPdfScale(width,800,330)).toThrow();});
