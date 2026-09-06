import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
export async function assertSyntheticTarget(){
 const ns=process.env.TRIA_INTEGRATION_NAMESPACE;
 if(process.env.TRIA_INTEGRATION_ISOLATED!=='confirmed'||process.env.TRIA_RUNTIME==='railway'||!/^tria-(?:adjustments|evidence|vault)-[a-z0-9_-]+$/.test(ns??'')||process.env.TRIA_INSTANCE_NAMESPACE!==ns||process.env.PGHOST!=='db'||process.env.PGDATABASE!=='tria')throw Error('A fixture exige destino descartável e namespace explícito.');
 const password=await readFile(process.env.DB_APP_PASSWORD_FILE??'/run/secrets/db_app_password','utf8');
 const probe=postgres({host:'db',database:'tria',username:'tria_app',password:password.trim(),max:1,prepare:false});
 try{const [marker]=await probe`SELECT namespace FROM runtime_instance_marker WHERE singleton`;if(marker?.namespace!==ns)throw Error('O banco não pertence ao namespace descartável da fixture.');}finally{await probe.end();}
}
