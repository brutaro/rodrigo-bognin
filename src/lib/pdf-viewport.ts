// Limita resolução dos bitmaps mesmo se o PDF declarar páginas enormes.
export function boundedPdfScale(width:number,height:number,availableWidth:number,pixelRatio=1){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Dimensões de página inválidas.');
 return Math.min(Math.max(1,availableWidth)/width*Math.min(2,Math.max(1,pixelRatio)),2048/width,2048/height,Math.sqrt(1_500_000/(width*height)));
}
