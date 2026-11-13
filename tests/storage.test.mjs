import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';

const script = buildSync({stdin:{contents:`import {R2Adapter} from './api/src/adapters/r2';
export default {async fetch(req,env){try{const store=new R2Adapter({env});const key=new URL(req.url).pathname;
if(req.method==='PUT'){await store.putBytes(key,await req.arrayBuffer(),req.headers.get('content-type')||'application/octet-stream');return new Response('ok');}
if(req.method==='POST'){await store.putText(key,await req.text());return new Response('ok');}
const obj=await store.getObject(key);if(!obj)return new Response('missing',{status:404});const h=new Headers();obj.writeHttpMetadata(h);h.set('etag',obj.httpEtag);return new Response(obj.body,{headers:h});
}catch(e){return new Response(e.message,{status:e.status||500});}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).outputFiles[0].text;

async function runtime(t, bindings={}){
 const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-16',d1Databases:['DB'],bindings:{OBJECT_STORAGE:'d1',...bindings}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const migration='api/migrations/0005_object_storage.sql';
 if(existsSync(migration))for(const sql of readFileSync(migration,'utf8').split(';').filter(x=>x.trim()))await db.prepare(sql).run();
 return {mf,db};
}

test('D1-only storage preserves multi-chunk bytes, HTTP metadata, text and overwrites',async t=>{
 const {mf}=await runtime(t);const bytes=Uint8Array.from({length:350000},(_,i)=>i%251);
 let r=await mf.dispatchFetch('http://storage.test/photo',{method:'PUT',headers:{'content-type':'image/webp'},body:bytes});assert.equal(r.status,200,await r.text());
 r=await mf.dispatchFetch('http://storage.test/photo');assert.equal(r.headers.get('content-type'),'image/webp');assert.match(r.headers.get('etag'),/^"[a-f0-9]{64}"$/);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
 assert.equal((await mf.dispatchFetch('http://storage.test/photo',{method:'POST',body:'品牌測試文字'})).status,200);
 r=await mf.dispatchFetch('http://storage.test/photo');assert.equal(await r.text(),'品牌測試文字');
 assert.equal((await mf.dispatchFetch('http://storage.test/missing')).status,404);
});

test('D1-only storage rejects oversized objects before writing',async t=>{
 const {mf}=await runtime(t);const r=await mf.dispatchFetch('http://storage.test/large',{method:'PUT',body:new Uint8Array(5*1024*1024+1)});assert.equal(r.status,413,await r.text());assert.equal((await mf.dispatchFetch('http://storage.test/large')).status,404);
});

test('D1 storage accepts and reconstructs a 5 MiB image',async t=>{
 const {mf}=await runtime(t);const data=new Uint8Array(5*1024*1024).fill(127);const r=await mf.dispatchFetch('http://storage.test/limit',{method:'PUT',body:data});assert.equal(r.status,200,await r.text());assert.deepEqual(new Uint8Array(await (await mf.dispatchFetch('http://storage.test/limit')).arrayBuffer()),data);
});

test('a full D1 store refuses new files atomically and allows shrinking an existing object',async t=>{
 const {mf,db}=await runtime(t);
 assert.equal((await mf.dispatchFetch('http://storage.test/existing',{method:'POST',body:'previous'})).status,200);
 await db.prepare('UPDATE app_storage_usage SET bytes_used = 52428800 WHERE id = 1').run();
 let r=await mf.dispatchFetch('http://storage.test/rejected',{method:'POST',body:'new'});assert.equal(r.status,413,await r.text());assert.equal((await mf.dispatchFetch('http://storage.test/rejected')).status,404);
 r=await mf.dispatchFetch('http://storage.test/existing',{method:'POST',body:'a longer replacement'});assert.equal(r.status,413,await r.text());assert.equal(await (await mf.dispatchFetch('http://storage.test/existing')).text(),'previous');
 assert.equal((await mf.dispatchFetch('http://storage.test/existing',{method:'POST',body:'ok'})).status,200);
 assert.equal((await db.prepare('SELECT bytes_used FROM app_storage_usage').first()).bytes_used,52428800-6);
});
