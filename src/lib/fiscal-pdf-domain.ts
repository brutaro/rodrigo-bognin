export const fiscalPdfLimitBytes=10*1024*1024;
export function fiscalNumberKey(number:string) {
 const normalized=number.trim().toLowerCase().replace(/\s+/g,' ');
 const digits=/^(?:(?:nfs[ -]*e|nfse)\s*[:#-]?\s*)?(\d+)$/.exec(normalized);
 return digits ? BigInt(digits[1]).toString() : normalized;
}
export function validatePdfEnvelope(bytes:Uint8Array) {
 const head=new TextDecoder('ascii').decode(bytes.subarray(0,12));
 const tail=new TextDecoder('ascii').decode(bytes.subarray(Math.max(0,bytes.length-1024)));
 if(!/^%PDF-[12]\.\d/.test(head)||!tail.includes('%%EOF'))throw Error('O arquivo não tem uma estrutura PDF reconhecível. Confira o documento.');
}
