import {it,expect} from 'vitest';
import {validateContextBackupDocument,validateContextBackupEnvelope} from '../../scripts/context-backup-shape.mjs';
const document={project_id:null,include_in_publication:false,status:'active'};
const version={id:'context-1',evidence_asset_id:null,version:1,status:'active',media_type:'application/pdf',original_name:'Contexto.pdf',size_bytes:'100'};
it('aceita contexto global no catálogo sem vínculos de fonte ou publicação',()=>{expect(()=>validateContextBackupDocument(document,[version],[])).not.toThrow();});
it('recusa contexto vinculado a projeto/evidência/fonte/publicação ou formato inválido',()=>{
 expect(()=>validateContextBackupDocument({...document,project_id:'A'},[version],[])).toThrow();
 for(const patch of [{evidence_asset_id:'hash'},{media_type:'text/plain'},{original_name:'fake.txt'},{size_bytes:'52428801'}])expect(()=>validateContextBackupDocument(document,[{...version,...patch}],[])).toThrow();
 expect(()=>validateContextBackupDocument(document,[version],[{}])).toThrow();
 expect(()=>validateContextBackupDocument(document,[version],[],[{file_version_id:version.id}])).toThrow();
});
it('confere envelope PDF dos bytes restaurados',()=>{
 expect(()=>validateContextBackupEnvelope(Buffer.from('%PDF-1.7'),Buffer.from('%%EOF'))).not.toThrow();
 expect(()=>validateContextBackupEnvelope(Buffer.from('fake'),Buffer.from('%%EOF'))).toThrow();
 expect(()=>validateContextBackupEnvelope(Buffer.from('%PDF-1.7'),Buffer.from('truncated'))).toThrow();
});
