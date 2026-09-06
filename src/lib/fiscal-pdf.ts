import {receiveFiscalDocument,fiscalDocumentSource,readFiscalDocument,prepareFiscalDocument} from './fiscal-document';
export const receiveFiscalPdf=(request:Request)=>receiveFiscalDocument(request,'pdf');
export const fiscalPdfSource=(id:string)=>fiscalDocumentSource(id,'pdf');
export const readFiscalPdf=(id:string)=>readFiscalDocument(id,'pdf');
export const prepareFiscalPdf=(id:string,input:{number:string;date:string;amount:string;category:string;project:string})=>prepareFiscalDocument(id,input,'pdf');
