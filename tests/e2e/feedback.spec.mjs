import fs from 'node:fs';

import { schoolSession } from '../school-session-fixture.mjs';
import { expect, test } from '../session-fixture.mjs';
const base='http://127.0.0.1:18786';
const fixture=()=>({id:'case-one',sender:'sender@example.test',subject:'Synthetic feedback',body:'<script>window.injected=true</script> Evidence',authentication_results:'untrusted.example; spf=pass',suspicious:true,state:'new',assignee:'',note:'',revision:1,received_at:'2026-11-15T00:00:00Z',closed_at:null,attachments:[{id:'one',name:'proof.txt',content_type:'text/plain',size:5,status:'stored'}],replies:[]});
test.beforeEach(async({page})=>{await schoolSession(page);await page.route('**/api/v1/system/capabilities',route=>route.fulfill({json:{api_version:1,capabilities:['moderation.tasks']}}));});
test('feedback preserves pending writes and reply identity across retry',async({page},info)=>{
 const text=JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,'utf8')).feedback;
 let message=fixture();const replyKeys=[];let outage=true;
 await page.route('**/api/v1/moderation/feedback**',async route=>{
  const request=route.request();const path=new URL(request.url()).pathname;
  if(path.endsWith('/attachments/one'))return route.fulfill({body:'proof',headers:{'content-type':'application/octet-stream'}});
  if(path.endsWith('/replies')){
   replyKeys.push(request.headers()['idempotency-key']);
   if(outage){outage=false;return route.fulfill({status:503,json:{code:'unavailable'}})}
   const reply={id:'reply-one',body:request.postDataJSON().body,actor:'operator',state:'unknown',created_at:'2026-11-15T01:00:00Z'};message.replies=[reply];return route.fulfill({json:reply});
  }
  if(request.method()==='PATCH'){message={...message,...request.postDataJSON(),revision:message.revision+1,assignee:'operator'};return route.fulfill({json:message});}
  return route.fulfill({json:path.endsWith('/case-one')?message:{items:[message],next_cursor:''}});
 });
 await page.goto(`${base}/moderation/feedback?lang=${info.project.metadata.locale}`);
 await page.getByRole('button').filter({hasText:'Synthetic feedback'}).click();
 await expect(page.getByText(text.suspiciousHelp)).toBeVisible();
 expect(await page.evaluate(()=>window.injected)).toBeUndefined();
 await page.getByLabel(text.note,{exact:true}).fill('Internal evidence');
 await page.getByLabel(text.state,{exact:true}).selectOption('processing');
 await page.getByRole('button',{name:text.save,exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:text.saved})).toBeVisible();
 await page.getByLabel(text.reply,{exact:true}).fill('Synthetic reply');
 await page.getByRole('button',{name:text.send,exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByLabel(text.reply,{exact:true})).toHaveValue('Synthetic reply');
 await expect(page.getByLabel(text.reply,{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:text.retry,exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:text.unknown})).toBeVisible();
 expect(replyKeys).toHaveLength(2);expect(replyKeys[0]).toBe(replyKeys[1]);
 await expect(page.getByLabel(text.reply,{exact:true})).toHaveValue('');
 if(info.project.metadata.locale==='ar-EG')await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('feedback.png'),fullPage:true});
});
test('feedback clears private mail after permission revocation',async({page},info)=>{
 let denied=false;const text=JSON.parse(fs.readFileSync(`apps/web-antd/src/locales/langs/${info.project.metadata.locale}/page.json`,'utf8')).feedback;
 await page.route('**/api/v1/moderation/feedback**',route=>denied?route.fulfill({status:403,json:{code:'forbidden'}}):route.fulfill({json:route.request().url().includes('/case-one')?fixture():{items:[fixture()],next_cursor:''}}));
 await page.goto(`${base}/moderation/feedback?lang=${info.project.metadata.locale}`);await page.getByRole('button').filter({hasText:'Synthetic feedback'}).click();
 await expect(page.getByText('sender@example.test',{exact:false}).last()).toBeVisible();denied=true;await page.getByRole('button',{name:text.refresh,exact:true}).click();
 await expect(page.getByText('sender@example.test',{exact:false})).toHaveCount(0);await expect(page.getByRole('alert')).toBeVisible();
});

test('feedback reply refresh cannot overwrite another operators note with a newer revision', async ({ page }, info) => {
  const text = JSON.parse(fs.readFileSync('apps/web-antd/src/locales/langs/' + info.project.metadata.locale + '/page.json', 'utf8')).feedback;
  let message = fixture(); const writes = [];
  await page.route('**/api/v1/moderation/feedback**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      const reply = { id: 'reply', actor: 'operator', body: request.postDataJSON().body, state: 'sent', created_at: message.received_at };
      message = { ...message, revision: 3, note: 'Other operator note', state: 'processing', replies: [reply] };
      return route.fulfill({ json: reply });
    }
    if (request.method() === 'PATCH') { writes.push(request.postDataJSON()); return route.fulfill({ status: 409, json: { code: 'conflict' } }); }
    return route.fulfill({ json: path.endsWith('/case-one') ? message : { items: [message], next_cursor: '' } });
  });
  await page.goto(base + '/moderation/feedback?lang=' + info.project.metadata.locale);
  await page.getByRole('button').filter({ hasText: 'Synthetic feedback' }).click();
  await page.getByLabel(text.note, { exact: true }).fill('My unsaved note');
  await page.getByLabel(text.reply, { exact: true }).fill('Reply');
  await page.getByRole('button', { name: text.send, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: text.sent })).toBeVisible();
  await expect(page.getByLabel(text.note, { exact: true })).toHaveValue('My unsaved note');
  await page.getByRole('button', { name: text.save, exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(writes).toEqual([{ revision: 1, state: 'new', note: 'My unsaved note' }]);
  expect(message.note).toBe('Other operator note');
});

test('feedback known rejections preserve editable drafts and issue new request keys', async ({ page }, info) => {
  const text = JSON.parse(fs.readFileSync('apps/web-antd/src/locales/langs/' + info.project.metadata.locale + '/page.json', 'utf8')).feedback;
  const keys = []; let replyStatus = 400; let updateStatus = 400;
  await page.route('**/api/v1/moderation/feedback**', route => {
    const request = route.request();
    if (request.method() === 'POST') { keys.push(request.headers()['idempotency-key']); return route.fulfill({ status: replyStatus, json: {} }); }
    if (request.method() === 'PATCH') { keys.push(request.headers()['idempotency-key']); return route.fulfill({ status: updateStatus, json: {} }); }
    return route.fulfill({ json: new URL(request.url()).pathname.endsWith('/case-one') ? fixture() : { items: [fixture()], next_cursor: '' } });
  });
  await page.goto(base + '/moderation/feedback?lang=' + info.project.metadata.locale);
  await page.getByRole('button').filter({ hasText: 'Synthetic feedback' }).click();
  for (const status of [400, 404, 409]) {
    replyStatus = status;
    await page.getByLabel(text.reply, { exact: true }).fill('Reply draft ' + status);
    await page.getByRole('button', { name: text.send, exact: true }).click();
    await expect(page.getByLabel(text.reply, { exact: true })).toBeEnabled();
    await expect(page.getByLabel(text.reply, { exact: true })).toHaveValue('Reply draft ' + status);
  }
  for (const status of [400, 404, 409]) {
    updateStatus = status;
    await page.getByLabel(text.note, { exact: true }).fill('Note draft ' + status);
    await page.getByRole('button', { name: text.save, exact: true }).click();
    await expect(page.getByLabel(text.note, { exact: true })).toBeEnabled();
    await expect(page.getByLabel(text.note, { exact: true })).toHaveValue('Note draft ' + status);
  }
  expect(new Set(keys).size).toBe(6);
});
