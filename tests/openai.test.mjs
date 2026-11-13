import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'branddna-openai-tests-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const out = join(dir, 'openai.mjs');
writeFileSync(out, buildSync({ entryPoints: ['api/src/adapters/openai.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22' }).outputFiles[0].text);
const { OpenAIAdapter, estimateCostUsd } = await import(pathToFileURL(out).href);

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
function context(env = {}) { return { env: { OPENAI_API_KEY: 'sk-test', ...env }, state: { aiUsage: [] } }; }
function reply(body, status = 200) { return { ok: status < 400, status, json: async () => body }; }
const okText = (text, extra = {}) => reply({ model: 'gpt-6-luna', output_text: text, usage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 1500 } }, ...extra });

test('cheap default model, lowest reasoning effort, strict schema and a prompt-cache key are sent', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return okText('{"suggestions":[]}'); };
  const ctx = context();
  const schema = { name: 's', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } };
  await new OpenAIAdapter(ctx).generateJson('marketing_suggestions', 'Return JSON', 'sys', { temperature: 0.5, schema });
  const body = calls[0];
  assert.equal(body.model, 'gpt-6-luna');
  assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.equal(body.temperature, undefined);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.prompt_cache_key, 'branddna-marketing_suggestions');
  assert.equal(body.max_output_tokens, 900);
  // 500 fresh × $0.10 + 1500 cached × $0.01 + 300 out × $0.50 per 1M tokens
  assert.equal(ctx.state.aiUsage[0].cost_usd, 0.000215);
});

test('a rejected parameter costs one retry, then is never sent again by this isolate', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if ('prompt_cache_key' in body) return reply({ error: { message: "Unsupported parameter: 'prompt_cache_key'.", param: 'prompt_cache_key' } }, 400);
    return okText('done');
  };
  const adapter = new OpenAIAdapter(context({ OPENAI_MODEL_DEFAULT: 'gpt-6-test-model' }));
  assert.equal(await adapter.generateText('default', 'hi', 'sys'), 'done');
  assert.equal(calls.length, 2);
  await adapter.generateText('default', 'again', 'sys');
  assert.equal(calls.length, 3);
  assert.equal('prompt_cache_key' in calls[2], false);
});

test('a reply cut off by the output cap is retried once with double the cap', async () => {
  const caps = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); caps.push(body.max_output_tokens);
    return caps.length === 1 ? okText('{"a":', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) : okText('{"a":1}');
  };
  const ctx = context();
  assert.deepEqual(await new OpenAIAdapter(ctx).generateJson('simulation', 'Return JSON', 'sys'), { a: 1 });
  assert.deepEqual(caps, [2000, 4000]);
  assert.equal(ctx.state.aiUsage.length, 2, 'both billed attempts are recorded');
});

test('image generation uses the gpt-image replacement without response_format and records its cost', async () => {
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return reply({ data: [{ b64_json: Buffer.from('png').toString('base64') }], usage: { input_tokens: 100, output_tokens: 1000 } }); };
  const ctx = context();
  const image = await new OpenAIAdapter(ctx).generateImage('brand_image', 'a truck', { size: '1024x1024', quality: 'low' });
  assert.equal(body.model, 'gpt-image-2.5-flare');
  assert.equal(body.response_format, undefined);
  assert.equal(body.quality, 'low');
  assert.equal(body.output_format, 'webp');
  assert.equal(body.output_compression, 80);
  assert.equal(image.contentType, 'image/webp');
  assert.equal(ctx.state.aiUsage[0].cost_usd, 0.0305);
});

test('image generation keeps caller supplied high quality and large sizes within demo cost limits', async () => {
  let body;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return reply({data:[{b64_json:Buffer.from('webp').toString('base64')}],usage:{input_tokens:1,output_tokens:1}}); };
  await new OpenAIAdapter(context()).generateImage('character_image','a character',{size:'4096x4096',quality:'high'});
  assert.equal(body.quality,'low');assert.equal(body.size,'1024x1024');assert.equal(body.n,1);
});

test('the weekly budget guard runs before any billable call', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return okText('x'); };
  const adapter = new OpenAIAdapter(context(), async () => { throw new Error('budget used up'); });
  await assert.rejects(adapter.generateText('default', 'hi', 'sys'), /budget/);
  assert.equal(fetched, false);
});

test('cost table covers the chosen models and leaves unknown models unpriced', () => {
  assert.equal(estimateCostUsd('gpt-6.1-terra-2026-10-01', 'text', 10000, 0, 2000), 0.02);
  assert.equal(estimateCostUsd('some-new-model', 'text', 1, 0, 1), null);
});
