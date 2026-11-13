import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';

const script=buildSync({entryPoints:['api/src/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).outputFiles[0].text;
async function runtime(t){
 let calls=0;
 const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-06-16',d1Databases:['DB'],bindings:{OBJECT_STORAGE:'d1',OPENAI_API_KEY:'sk-test'},outboundService:async req=>{
   calls++;assert.equal(new URL(req.url).hostname,'api.openai.com');
   const image=req.url.endsWith('/images/generations');
   return Response.json(image?{model:'gpt-image-2.5-flare',data:[{b64_json:Buffer.from('test-webp').toString('base64')}],usage:{input_tokens:100,output_tokens:1000}}:{model:'gpt-6-luna',output_text:'Breakfast Sandwich NT$100 僅供測試',usage:{input_tokens:300,output_tokens:30}});
 }});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of ['0001_init.sql','0002_remove_account_usage_scope.sql','0005_object_storage.sql'])for(const sql of readFileSync('api/migrations/'+name,'utf8').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 const post=(path,body)=>mf.dispatchFetch('http://llm.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {mf,db,post,calls:()=>calls};
}

test('D1-only LLM runtime stores and serves generated images without R2',async t=>{
 const {mf,post}=await runtime(t);const r=await post('/api/generate-brand-image',{prompt:'test breakfast'});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));assert.equal(j.ai_usage.calls,1);assert.equal(j.ai_usage.cost_usd,0.0305);assert.match(j.file_url,/\.webp$/);
 const image=await mf.dispatchFetch('http://llm.test'+j.file_url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.equal(await image.text(),'test-webp');
});

test('a paid inference is accounted for even when storing its output fails',async t=>{
 const {db,post}=await runtime(t);
 await db.exec("CREATE TRIGGER storage_test_failure BEFORE INSERT ON app_objects BEGIN SELECT RAISE(ABORT, 'test storage unavailable'); END");
 const r=await post('/api/generate-brand-image',{prompt:'test breakfast'});const j=await r.json();assert.equal(r.status,500);assert.equal(j.ai_usage?.calls,1,'error response must expose paid usage');
 const usage=await db.prepare("SELECT metadata_json FROM usage_events WHERE feature='openai_usage'").all();assert.equal(usage.results.length,1);assert.equal(JSON.parse(usage.results[0].metadata_json).items.length,1);
});

test('full storage stops an image call before spending tokens',async t=>{
 const {db,post,calls}=await runtime(t);await db.prepare('UPDATE app_storage_usage SET bytes_used=52428800').run();assert.equal((await post('/api/generate-brand-image',{prompt:'test'})).status,413);assert.equal(calls(),0);
});

test('D1-only image upload reaches the actual OCR adapter',async t=>{
 const {mf,post}=await runtime(t);const form=new FormData();form.set('source_type','custom');form.set('title','OCR test');form.set('file',new File(['image fixture'],'ocr.png',{type:'image/png'}));const req=new Request('http://llm.test/api/sources',{method:'POST',body:form});const upload=await mf.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:await req.arrayBuffer()});const u=await upload.json();assert.equal(upload.status,200,JSON.stringify(u));
 const ocr=await post('/api/sources/'+u.source.id+'/extract',{});const j=await ocr.json();assert.equal(ocr.status,200,JSON.stringify(j));assert.match(j.extraction.extracted_text,/100/);assert.equal(j.ai_usage.items[0].feature,'ocr');
});

test('explicit workspace reset releases D1 object capacity and preserves other brands',async t=>{
 const {db,post}=await runtime(t);const generated=await (await post('/api/generate-brand-image',{prompt:'test breakfast'})).json();assert.equal(generated.success,true);
 assert.ok((await db.prepare('SELECT bytes_used FROM app_storage_usage').first()).bytes_used>0);
 await db.prepare("INSERT INTO app_objects (key, content_type, size, etag, created_at) VALUES ('uploads/2/keep', 'text/plain', 0, 'other-brand', '2026-11-06')").run();
 const r=await post('/api/reset',{});assert.equal(r.status,200,await r.text());
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM app_objects').first()).n,1);assert.equal((await db.prepare("SELECT key FROM app_objects").first()).key,'uploads/2/keep');assert.equal((await db.prepare('SELECT COUNT(*) n FROM app_object_chunks').first()).n,0);assert.equal((await db.prepare('SELECT bytes_used FROM app_storage_usage').first()).bytes_used,0);
});

test('DNA overrides and character images preserve source IDs for unchanged-pipeline reuse',async t=>{
 const {db,post}=await runtime(t);
 await db.prepare("INSERT INTO brand_dna_snapshots (brand_id,result_json,manual_overrides_json,source_result_ids_json,active,created_at) VALUES (1,?, '{}','[17,21]',1,'2026-11-06')").bind(JSON.stringify({brand_name:'test'})).run();
 assert.equal((await post('/api/brand-dna/override',{overrides:{summary:'manual'}})).status,200);
 let row=await db.prepare('SELECT source_result_ids_json FROM brand_dna_snapshots WHERE active=1').first();assert.deepEqual(JSON.parse(row.source_result_ids_json),[17,21]);
 const r=await post('/api/generate-brand-character-image',{prompt:'test'});assert.equal(r.status,200,await r.text());row=await db.prepare('SELECT source_result_ids_json FROM brand_dna_snapshots WHERE active=1').first();assert.deepEqual(JSON.parse(row.source_result_ids_json),[17,21]);
});
