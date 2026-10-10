import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));

test('identidade do plugin preservada e versões sincronizadas',()=>{
  const meta=json('plugin.json');
  const legacy=json('.codex-plugin/plugin.json');
  const packageJson=json('package.json');
  assert.equal(meta.name,'portal-transparencia-brasil');
  assert.equal(meta.version,'0.3.0');
  assert.equal(meta.version,legacy.version);
  assert.equal(meta.version,packageJson.version);
  assert.equal(meta.extensions['com.openai'].interface.defaultPrompt.length,3);
  assert.deepEqual(meta.extensions['com.openai'].interface.defaultPrompt,legacy.interface.defaultPrompt);
});

test('onboarding ChatGPT é declarativo, existe e não solicita segredos no chat',()=>{
  const meta=json('plugin.json');
  const entry=meta.extensions['com.openai'].onboardingSkill;
  assert.equal(entry,'./skills/onboarding/SKILL.md');
  assert.ok(existsSync(resolve(root,entry)));
  const content=readFileSync(resolve(root,entry),'utf8');
  assert.match(content,/não peça para colar chave/i);
  assert.match(content,/portal_status/);
});

test('conexão local original continua preservada; HTTP remoto é opt-in',()=>{
  const mcp=json('mcp.json');
  assert.equal(mcp.mcpServers['portal-transparencia'].type,'stdio');
  assert.equal(mcp.mcpServers['portal-transparencia'].command,'node');
  assert.equal(mcp.mcpServers['portal-transparencia'].args[0],'${PLUGIN_ROOT}/server/index.mjs');
  assert.equal(json('.mcp.json').mcpServers['portal-transparencia'].type,'stdio');
  const scripts=json('package.json').scripts;
  assert.equal(scripts.start,'node server/index.mjs');
  assert.equal(scripts['start:http'],'node server/http.mjs');
  assert.ok(existsSync(resolve(root,'server/http.mjs')));
});
