import {test,expect} from '@playwright/test';

const PASSWORD=process.env.TRUCK_PASSWORD||'haihai2026';
/** Steps that affect every customer of the truck (pausing, bulk completion) only run against a local workspace. */
const LOCAL=!process.env.DEMO_URL;
async function login(page){
  await page.goto('/login');
  await page.locator('.known-account[data-username="haihai"]').click();
  const password=page.locator('#login-password');
  if(await password.isVisible().catch(()=>false)){
    await password.fill(PASSWORD);
    await page.getByRole('button',{name:/^登入/}).click();
  }
  await expect(page.locator('main.content')).toBeVisible({timeout:20000});
}
const state=async page=>(await (await page.request.get('/api/truck/state')).json()).state;
const knownRow=async(page,username)=>page.evaluate(name=>(JSON.parse(localStorage.getItem('branddna.truck.known.v1')||'[]')).find(row=>row.username===name)||null,username);

test('a previously used account fills in username and password with one click',async({page})=>{
  test.skip(PASSWORD!=='haihai2026','the flagship card is prefilled with the initial password');
  await page.goto('/login');
  await page.locator('.known-account[data-username="haihai"]').click();
  await expect(page.locator('#login-username')).toHaveValue('haihai');
  await expect(page.locator('#login-password')).toHaveValue(PASSWORD);
  await expect(page.locator('#login-saved-hint')).toBeVisible();
  await expect(page.locator('#login-form input[name="remember"]')).toBeChecked();
  await page.getByRole('button',{name:/^登入/}).click();
  await expect(page.locator('main.content')).toBeVisible({timeout:20000});
  expect((await knownRow(page,'haihai')).password).toBe(PASSWORD);

  // A remembered password that stopped working is forgotten instead of being retried.
  await page.evaluate(()=>{const list=JSON.parse(localStorage.getItem('branddna.truck.known.v1'));list[0].password='stale-password';localStorage.setItem('branddna.truck.known.v1',JSON.stringify(list));});
  await page.locator('.account-button').click();
  await page.getByRole('menuitem',{name:/登出這台餐車/}).click();
  await expect(page.locator('.known-account[data-username="haihai"]')).toContainText('已記住密碼',{timeout:20000});
  await page.locator('.known-account[data-username="haihai"]').click();
  await expect(page.locator('#login-password')).toHaveValue('stale-password');
  await page.getByRole('button',{name:/^登入/}).click();
  await expect(page.locator('#login-form .modal-error')).toContainText('已經失效');
  await expect(page.locator('#login-password')).toHaveValue('');
  expect((await knownRow(page,'haihai')).password).toBeUndefined();

  // Unticking 「記住密碼」 signs in without saving it.
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('#login-form input[name="remember"]').uncheck();
  await page.getByRole('button',{name:/^登入/}).click();
  await expect(page.locator('main.content')).toBeVisible({timeout:20000});
  expect((await knownRow(page,'haihai')).password).toBeUndefined();
});

test('merchant signs in, builds Brand DNA, drafts with the assistant, confirms and schedules',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const topic=`流程驗收-${Date.now()}`;
  await login(page);
  await page.goto('/diagnosis');
  await expect(page.getByText('品牌人格前五名')).toBeVisible();
  await expect(page.locator('.archetype-grid.top-five .archetype')).toHaveCount(5);
  await expect(page.locator('.dna-card')).toHaveCount(5);
  await page.getByRole('button',{name:'重新建立 Brand DNA'}).click();
  await expect(page.locator('#toast')).toContainText(/已重新建立|範本/,{timeout:45000});
  await page.getByRole('link',{name:'貼文工作區'}).click();
  // Quick start: 內容主軸 / 趨勢 / 季節性 / 餐車營運, starting from the Brand DNA pillars.
  await expect(page.locator('.quick-start [role="tab"]')).toHaveCount(4);
  await expect(page.locator('.qs-group').first()).toBeVisible();
  // Rebuilt diagnoses use the tone library: hovering a tone shows its definition and example.
  await page.goto('/diagnosis');
  await page.locator('.dna-card .lib-tag').first().hover();
  await expect(page.locator('.dna-card .lib-tag .lib-tip').first()).toBeVisible();
  await expect(page.locator('#comparison .compare-table tbody tr')).toHaveCount(10);
  await page.getByRole('link',{name:'貼文工作區'}).click();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await page.locator('#post-platform').selectOption('facebook');
  await page.locator('#post-topic').fill(topic);
  await page.getByRole('button',{name:'產生草稿'}).click();
  await expect(page.locator('#edit-caption')).not.toBeEmpty({timeout:45000});
  await page.locator('#edit-card').fill('一起向前，一起吃飯');
  await page.getByRole('button',{name:'確認內容',exact:true}).click();
  await expect(page.locator('#editor-form .badge.approved')).toBeVisible();
  await page.locator('#edit-caption').fill(`${topic}\n編輯後的品牌文案`);
  await page.getByRole('button',{name:'排程發布',exact:true}).click();
  await expect(page.getByRole('button',{name:'確認內容',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'確認內容',exact:true}).click();
  await page.getByRole('button',{name:'排程發布',exact:true}).click();
  const next=new Date(Date.now()+86400000).toISOString().slice(0,16);
  await page.locator('#schedule-at').fill(next);
  await page.getByRole('button',{name:'確認排程',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('排程');
  const scheduled=(await state(page)).posts.find(p=>p.caption.startsWith(topic));
  expect(scheduled.status).toBe('scheduled');
  await page.goto('/calendar');
  if(scheduled.scheduledAt.slice(0,7)!==new Date().toISOString().slice(0,7))await page.getByRole('button',{name:'下一個月'}).click();
  await expect(page.locator(`.calendar-event.post[data-id="${scheduled.id}"]`)).toBeVisible();
  // Only one "add outing" button, and the legend uses the event colours.
  await expect(page.getByRole('button',{name:/新增出攤/})).toHaveCount(1);
  const legend=await page.locator('.legend-post').evaluate(el=>getComputedStyle(el,'::before').backgroundColor);
  const event=await page.locator('.calendar-event.post').first().evaluate(el=>getComputedStyle(el).borderLeftColor);
  expect(legend).toBe(event);
  expect(errors).toEqual([]);
});

test('customer joins with a profile, gets a reward code, orders with it; merchant fulfils',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const customer=await context.newPage();
  const errors=[];customer.on('pageerror',e=>errors.push(e.message));
  await customer.goto('/order');
  await expect(customer.getByText(/示範|測試|模擬|LINE/)).toHaveCount(0);
  await customer.locator('[data-action="member-entry"]').click();
  const name=`測試夥伴${Date.now()}`;
  const phone=`09${String(Date.now()).slice(-8)}`;
  await customer.locator('input[name="name"]').fill(name);
  await customer.locator('input[name="phone"]').fill(phone);
  await customer.locator('.customer-profile summary').click();
  await customer.locator('.customer-pills label').filter({hasText:/^女$/}).click();
  await customer.locator('select[name="birthYear"]').selectOption('1996');
  // 行政區 waits for 縣市 and then lists only that city's districts.
  await expect(customer.locator('select[name="district"]')).toBeDisabled();
  await customer.locator('select[name="city"]').selectOption('台北市');
  await expect(customer.locator('select[name="district"] option')).toHaveCount(13);
  await customer.locator('select[name="district"]').selectOption('大安區');
  await customer.locator('select[name="occupation"]').selectOption('上班族');
  await customer.locator('select[name="income"]').selectOption('4–6 萬');
  await customer.locator('[data-flag="consent"]').check();
  await customer.getByRole('button',{name:/加入會員，開始點餐/}).click();
  const code=(await customer.locator('.customer-reward-code strong').textContent()).trim();
  expect(code).toMatch(/^HI[A-Z2-9]{6}$/);
  await customer.locator('.customer-reward [data-action="use-offer"]').click();
  await expect(customer.getByText('今天想吃什麼？')).toBeVisible();
  await customer.getByRole('button',{name:'加入 海陸炒泡麵',exact:true}).click();
  await customer.getByRole('button',{name:'加入 海陸炒泡麵',exact:true}).click();
  await customer.locator('[data-action="cart"]').click();
  await customer.locator('[data-action="checkout"]').click();
  await expect(customer.locator('.customer-coupon-applied')).toContainText(code);
  await customer.locator('textarea[name="note"]').fill('流程驗收，請勿製作真實餐點');
  await customer.screenshot({path:'test-results/customer-checkout.png',fullPage:true});
  await customer.locator('[data-action="submit-order"]').click();
  await expect(customer.getByRole('heading',{name:'訂單收到囉！'})).toBeVisible();
  const merchant=await browser.newPage();
  await login(merchant);
  const order=(await state(merchant)).orders.find(o=>o.customer.name===name);
  expect([order.subtotal,order.discount.code,order.total]).toEqual([200,code,170]);
  expect(order.memberId).toBeTruthy();
  await merchant.goto('/orders');
  await expect(merchant.locator('#asset-kit')).not.toHaveAttribute('open','');
  const card=merchant.locator('.order-card').filter({hasText:name});
  await expect(card).toContainText(code);
  await card.getByRole('button',{name:/接單並開始製作/}).click();
  await expect(customer.getByRole('heading',{name:'製作中'})).toBeVisible({timeout:15000});
  await card.getByRole('button',{name:/通知可取餐/}).click();
  await customer.bringToFront();
  await expect(customer.getByRole('heading',{name:'可以取餐囉！'})).toBeVisible({timeout:15000});
  await customer.locator('[data-action="lang"]').first().click();
  await expect(customer.getByRole('heading',{name:'Ready for pickup!'})).toBeVisible();
  await customer.screenshot({path:'test-results/customer-receipt-en.png',fullPage:true});
  expect(errors).toEqual([]);
  await merchant.close();await context.close();
});

test('order board: new-order alert, queue position, undo, cancel with the code returned, paused ordering and bulk completion',async({browser})=>{
  const merchant=await browser.newPage();const errors=[];merchant.on('pageerror',e=>errors.push(e.message));
  await login(merchant);
  await merchant.goto('/orders');
  await expect(merchant.locator('.order-board, .ordering-bar').first()).toBeVisible();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const customer=await context.newPage();customer.on('pageerror',e=>errors.push(e.message));
  await customer.goto('/order');
  await customer.locator('[data-action="guest"]').click();
  const name=`看板驗收${Date.now()}`;
  const place=async(dish,code)=>{
    await customer.getByRole('button',{name:`加入 ${dish}`,exact:true}).click();
    await customer.getByRole('button',{name:`加入 ${dish}`,exact:true}).click();
    await customer.locator('[data-action="cart"]').click();
    await customer.locator('[data-action="checkout"]').click();
    await customer.locator('input[name="name"]').fill(name);
    await customer.locator('input[name="phone"]').fill('0911000222');
    if(code){await customer.locator('input[name="coupon"]').fill(code);await customer.locator('[data-action="apply-coupon"]').click();await expect(customer.locator('.customer-coupon-applied')).toContainText(code);}
    await customer.locator('[data-action="submit-order"]').click();
    await expect(customer.locator('.customer-ticket-top strong')).toBeVisible();
    return (await customer.locator('.customer-ticket-top strong').textContent()).trim();
  };
  const first=await place('海陸炒泡麵','IG20');
  expect(first).toMatch(/^\d{3}$|^[A-Z]\d+$/);
  await expect(customer.locator('.customer-ahead')).toBeVisible();
  // The merchant hears about it wherever they are: toast + waiting count in the tab title.
  await expect(merchant.locator('#toast')).toContainText(`新訂單 ${first}`,{timeout:15000});
  await expect(merchant).toHaveTitle(/^\(\d+\) 新訂單/);
  const card=merchant.locator('.order-column.new .order-card').filter({hasText:name});
  await expect(card).toBeVisible();
  // Undo a mis-tap.
  await card.getByRole('button',{name:/接單並開始製作/}).click();
  const cooking=merchant.locator('.order-column.cooking .order-card').filter({hasText:name});
  await cooking.getByRole('button',{name:'退回'}).click();
  await expect(merchant.locator('.order-column.new .order-card').filter({hasText:name})).toBeVisible();
  // Ordering again keeps following the first order.
  await customer.locator('[data-action="new-order"]').click();
  await expect(customer.locator('.customer-order-strip').filter({hasText:first})).toBeVisible();
  const second=await place('日式炒烏龍麵');
  await expect(customer.locator('.customer-order-switch')).toContainText(first);
  // Cancelling the first order returns its discount code and tells the customer.
  await merchant.locator('.order-column.new .order-card').filter({hasText:name}).filter({hasText:'IG20'}).getByRole('button',{name:'取消'}).click();
  await merchant.locator('#cancel-form').getByText('餐點售完').click();
  await merchant.locator('#cancel-form').getByRole('button',{name:'確定取消訂單'}).click();
  await expect(merchant.locator('#toast')).toContainText('IG20 已退回');
  await expect(customer.getByRole('heading',{name:'訂單已取消'})).toBeVisible({timeout:15000});
  await expect(customer.locator('.customer-cancel-info')).toContainText('IG20');
  const coupon=(await (await merchant.request.get('/api/truck/state')).json()).state.coupons.find(c=>c.code==='IG20');
  expect(coupon.usedBy).not.toContain('0911000222');
  // Second order: straight to ready, then bulk completion.
  await customer.locator('[data-action="view-order"]').filter({hasText:second}).click();
  const secondCard=merchant.locator('.order-card').filter({hasText:name}).filter({hasText:'日式炒烏龍麵'});
  await secondCard.getByRole('button',{name:/接單並開始製作/}).click();
  await merchant.locator('.order-card').filter({hasText:name}).filter({hasText:'日式炒烏龍麵'}).getByRole('button',{name:/通知可取餐/}).click();
  await expect(customer.getByRole('heading',{name:'可以取餐囉！'})).toBeVisible({timeout:15000});
  if(LOCAL){
    // Bulk completion and pausing touch every customer of the truck, so they only run against a local workspace.
    await merchant.getByRole('button',{name:/全部完成取餐/}).click();
    await merchant.locator('.modal').getByRole('button',{name:'全部完成',exact:true}).click();
    await expect(merchant.locator('.order-column.ready .order-card')).toHaveCount(0);
  }else await merchant.locator('.order-card').filter({hasText:name}).getByRole('button',{name:/完成取餐/}).click();
  await expect(customer.getByRole('heading',{name:'已取餐'})).toBeVisible({timeout:15000});
  if(LOCAL){
    try{
      await merchant.getByRole('button',{name:'暫停接單'}).click();
      await merchant.locator('#ordering-message').fill('驗收暫停中');
      await merchant.locator('#ordering-form').getByRole('button',{name:'暫停接單'}).click();
      await expect(merchant.locator('.ordering-bar.paused')).toBeVisible();
      await customer.locator('[data-action="new-order"]').click();
      await expect(customer.locator('.customer-paused')).toContainText('驗收暫停中',{timeout:15000});
      await expect(customer.getByRole('button',{name:'加入 海陸炒泡麵',exact:true})).toBeDisabled();
      await merchant.getByRole('button',{name:'恢復接單'}).click();
      await expect(customer.locator('.customer-paused')).toHaveCount(0,{timeout:15000});
    }finally{
      await merchant.request.post('/api/truck/actions',{data:{type:'settings.update',payload:{ordering:{paused:false}}}});
    }
  }
  expect(errors).toEqual([]);
  await merchant.close();await context.close();
});

test('an existing member phone needs the code from the truck; a sold-out item leaves the cart with a note',async({browser})=>{
  const merchant=await browser.newPage();
  await login(merchant);
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const customer=await context.newPage();const errors=[];customer.on('pageerror',e=>errors.push(e.message));
  await customer.goto('/order');
  await customer.locator('[data-action="member-entry"]').click();
  await customer.locator('input[name="name"]').fill('冒用驗收');
  await customer.locator('input[name="phone"]').fill('0911111111');
  await customer.getByRole('button',{name:/加入會員，開始點餐/}).click();
  await expect(customer.locator('.customer-code-field')).toBeVisible();
  await expect(customer.locator('[data-action="member-center"]')).toHaveCount(0);
  const before=(await (await merchant.request.get('/api/truck/state')).json()).state.members.find(m=>m.phone==='0911111111');
  expect(before.name).not.toBe('冒用驗收');
  // In person: the merchant opens the member and issues a one-time code.
  await merchant.goto('/members');
  await merchant.locator('[data-action="member-open"]').filter({hasText:before.name}).first().click();
  await merchant.getByRole('button',{name:/產生登入碼/}).click();
  const code=(await merchant.locator('.login-code').textContent()).trim();
  await customer.locator('input[name="loginCode"]').fill(code);
  await customer.locator('input[name="name"]').fill(before.name);
  await customer.getByRole('button',{name:/登入會員/}).click();
  await expect(customer.locator('.customer-menu-brand')).toContainText(before.name);
  // Sold out while in the cart (a temporary item, so real menu items are never marked sold out).
  const dish=`售完驗收${Date.now()}`;
  await merchant.keyboard.press('Escape');
  await merchant.goto('/menu');
  await merchant.getByRole('button',{name:'新增餐點'}).click();
  await merchant.locator('#menu-name').fill(dish);
  await merchant.locator('#menu-price').fill('90');
  await merchant.getByRole('button',{name:'儲存餐點',exact:true}).click();
  await expect(customer.getByRole('button',{name:`加入 ${dish}`,exact:true})).toBeVisible({timeout:15000});
  await customer.getByRole('button',{name:`加入 ${dish}`,exact:true}).click();
  await customer.getByRole('button',{name:'加入 海陸炒泡麵',exact:true}).click();
  const row=merchant.locator('.menu-row').filter({hasText:dish});
  await row.locator('.switch').click();
  await expect(customer.locator('.customer-notice')).toContainText(`「${dish}」剛剛售完`,{timeout:15000});
  await expect(customer.locator('.customer-cart-count')).toHaveText('1');
  await row.getByRole('button',{name:/編輯/}).click();
  await merchant.getByRole('button',{name:/刪除餐點/}).click();
  await merchant.locator('.modal').getByRole('button',{name:'刪除',exact:true}).click();
  await expect(merchant.locator('.menu-row').filter({hasText:dish})).toHaveCount(0);
  // Hidden form fields really are hidden (campaign offer type).
  await merchant.goto('/members');
  await merchant.locator('.segment-card').last().getByRole('button',{name:/推播優惠/}).click();
  await expect(merchant.locator('#campaign-form [data-offer="bogo"]')).toBeHidden();
  expect(errors).toEqual([]);
  await merchant.close();await context.close();
});

test('a member sees and edits their own profile; the district follows the city',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const customer=await context.newPage();
  const errors=[];customer.on('pageerror',e=>errors.push(e.message));
  await customer.goto('/order');
  await customer.locator('[data-action="member-entry"]').click();
  await customer.locator('input[name="name"]').fill(`資料驗收${Date.now()}`);
  await customer.locator('input[name="phone"]').fill(`09${String(Date.now()).slice(-8)}`);
  await customer.locator('.customer-profile summary').click();
  await customer.locator('.customer-pills label').filter({hasText:/^男$/}).click();
  await customer.locator('select[name="birthYear"]').selectOption('1990');
  await customer.locator('select[name="city"]').selectOption('台中市');
  await customer.locator('select[name="district"]').selectOption('西屯區');
  await customer.locator('select[name="occupation"]').selectOption('學生');
  await customer.locator('select[name="income"]').selectOption('2 萬以下');
  await expect(customer.locator('.customer-profile-progress')).toContainText('必填都完成了');
  await customer.locator('[data-flag="consent"]').check();
  await customer.getByRole('button',{name:/加入會員，開始點餐/}).click();
  await customer.locator('.customer-reward [data-action="use-offer"]').click();
  await customer.locator('.customer-menu-header [data-action="member-center"]').click();
  await expect(customer.locator('.customer-profile-summary')).toContainText('台中市 西屯區');
  await customer.getByRole('button',{name:/修改資料/}).click();
  await customer.locator('select[name="city"]').selectOption('高雄市');
  await expect(customer.locator('select[name="district"]')).toHaveValue('');
  await customer.locator('select[name="district"]').selectOption('鳳山區');
  await customer.locator('input[name="editName"]').fill('改名驗收');
  await customer.getByRole('button',{name:'儲存變更'}).click();
  await expect(customer.locator('.customer-notice')).toContainText('資料已更新');
  await expect(customer.locator('.customer-profile-summary')).toContainText('高雄市 鳳山區');
  await expect(customer.locator('.customer-profile-summary')).toContainText('改名驗收');
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop and mobile routes render without page errors or horizontal overflow',async({browser})=>{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await login(page);
    for(const route of ['/dashboard','/data-hub','/diagnosis','/generate','/calendar','/orders','/menu','/analytics','/members','/settings','/guide']){
      await page.goto(route);await expect(page.locator('main.content')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route).toBe(true);
      for(const chrome of ['.page-heading','.sidebar','.topbar','.footer-note','.notice'])for(const text of await page.locator(chrome).allInnerTexts())expect(text,`${route} ${chrome}`).not.toMatch(/示範|模擬|課堂|Demo|試用/);
    }
    await page.goto('/order');await expect(page.locator('.customer-device')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'/order').toBe(true);
    await page.goto('/dashboard');await expect(page.locator('.hero')).toBeVisible();
    await page.screenshot({path:`test-results/dashboard-${viewport.width}.png`,fullPage:true});
    expect(errors).toEqual([]);await page.close();
  }
});

test('data center edits, manual publishing metrics feed back, menu and outing edits persist',async({page})=>{
  const label=`擴充驗收-${Date.now()}`;
  await login(page);
  await page.goto('/data-hub');
  // Adding data happens in the panel on the page itself (no 進階匯入 dialog).
  await expect(page.locator('#import')).toBeVisible();
  await page.locator('#add-title').fill(label);
  await page.locator('#add-file').setInputFiles({name:'brand-story.txt',mimeType:'text/plain',buffer:Buffer.from('溫暖真誠的餐車，透過友善工作支持每一位夥伴。')});
  await expect(page.locator('#add-content')).toHaveValue(/友善工作/);
  await page.locator('#add-manual-form button[type="submit"]').click();
  const row=page.locator('tr').filter({hasText:label});
  await row.getByRole('button',{name:`編輯 ${label}`}).click();
  await page.locator('#source-title').fill(`${label}-改`);
  await page.locator('#source-form button[type="submit"]').click();
  await expect(page.locator('tr').filter({hasText:`${label}-改`})).toBeVisible();
  // 官網 HTML: the browser reads the saved page; menus, scripts and footers are left out.
  await page.getByRole('tab',{name:/官網 HTML/}).click();
  await expect(page.locator('.howto-card li')).toHaveCount(3);
  await page.locator('#import-html-files').setInputFiles({name:'about.html',mimeType:'text/html',buffer:Buffer.from(`<!-- saved from url=(0026)https://example.com/about --><html><head><meta charset="utf-8"><title>${label} 官網</title></head><body><nav>首頁 菜單</nav><main><p>每一份麵都現點現做，蔬菜當天早上進貨。</p></main><script>var hidden='不該出現'</script></body></html>`)});
  await expect(page.locator('.html-preview li')).toContainText('現點現做');
  await expect(page.locator('.html-preview li')).not.toContainText('不該出現');
  await page.getByRole('button',{name:/匯入 1 個網頁/}).click();
  await expect(page.locator('#toast')).toContainText('已匯入 1 筆網頁內容');
  await page.getByRole('tab',{name:/批次貼上/}).click();
  await page.locator('#import-batch-text').fill(`${label} 第一篇\n---\n${label} 第二篇`);
  await page.locator('#import-batch-prefix').fill(label);
  await page.getByRole('button',{name:'匯入全部'}).click();
  await expect(page.locator('#toast')).toContainText('已匯入 2 筆');
  for(const name of [`${label}-改`,`網站｜${label} 官網`,`${label} 1`,`${label} 2`]){
    await page.locator('tr').filter({hasText:name}).getByRole('button',{name:`刪除 ${name}`}).click();
    await page.locator('.modal').getByRole('button',{name:'刪除',exact:true}).click();
    await expect(page.locator('tr').filter({hasText:name})).toHaveCount(0);
  }
  const generated=await (await page.request.post('/api/truck/actions',{data:{type:'post.generate',payload:{platform:'instagram',topic:label}}})).json();
  const postId=generated.result.post.id;
  await page.goto('/generate');
  await page.locator(`[data-action="post-edit"][data-id="${postId}"]`).click();
  await page.locator('#edit-photo').setInputFiles('pages/static/truck/brand/truck-official.jpg');
  await expect(page.locator('#preview-photo')).toHaveAttribute('src',/\/api\/truck\/media\//);
  await page.locator('#edit-card').fill(label);
  await page.getByRole('button',{name:'確認內容',exact:true}).click();
  await page.getByRole('button',{name:'標記為已發布',exact:true}).click();
  await page.getByRole('button',{name:'已經發出去了，標記為已發布'}).click();
  await page.getByRole('button',{name:/填寫成效/}).click();
  await page.locator('#metric-reach').fill('820');await page.locator('#metric-likes').fill('64');
  await page.getByRole('button',{name:'儲存成效'}).click();
  await page.goto('/analytics');
  await page.locator('[data-action="analytics-feedback"]').click();
  await expect(page).toHaveURL(/\/data-hub/);
  await expect(page.locator('tr.highlight')).toContainText('貼文成效回饋');
  await page.goto('/calendar');
  await page.getByRole('button',{name:'新增出攤',exact:true}).click();
  await page.locator('#stall-title').fill(label);
  await page.locator('#stall-location').fill('驗收地點');
  await page.getByRole('button',{name:'儲存出攤',exact:true}).click();
  await expect(page.locator('.calendar-event.stall').filter({hasText:label})).toBeVisible();
  await page.locator('.calendar-event.stall').filter({hasText:label}).click();
  await page.getByRole('button',{name:'刪除出攤'}).click();
  await page.locator('.modal').getByRole('button',{name:'刪除',exact:true}).click();
  await expect(page.locator('.calendar-event.stall').filter({hasText:label})).toHaveCount(0);
  await page.goto('/menu');
  await page.getByRole('button',{name:'新增餐點'}).click();
  await page.locator('#menu-name').fill(label);
  await page.locator('#menu-price').fill('150');
  await page.locator('#menu-form .fold summary').click();
  await page.locator('#menu-name-en').fill('Acceptance Bowl');
  await page.getByRole('button',{name:'儲存餐點',exact:true}).click();
  const item=page.locator('.menu-row').filter({hasText:label});
  await expect(item).toContainText('150');
  await item.locator('.switch').click();
  await expect(item).toContainText('今日售完');
  const publicMenu=(await (await page.request.get('/api/truck/public')).json()).state.menu;
  expect(publicMenu.find(m=>m.name===label).soldOut).toBe(true);
  await item.getByRole('button',{name:/編輯/}).click();
  await page.getByRole('button',{name:/刪除餐點/}).click();
  await page.locator('.modal').getByRole('button',{name:'刪除',exact:true}).click();
  await expect(page.locator('.menu-row').filter({hasText:label})).toHaveCount(0);
  const saved=await state(page);
  expect(saved.posts.find(p=>p.id===postId).cardTitle).toBe(label);
  expect(saved.posts.find(p=>p.id===postId).metrics.reach).toBe(820);
});

test('members are segmented, pushes reach the member center, notifications are categorised',async({page})=>{
  await login(page);
  await page.goto('/members');
  // Guests (ordered without joining) are listed by name and phone only, with no segments or analysis.
  await page.getByRole('tab',{name:/訪客/}).click();
  await expect(page.locator('.guest-table thead th')).toHaveCount(2);
  await expect(page.locator('.segment-card')).toHaveCount(0);
  await page.getByRole('tab',{name:/會員/}).click();
  await expect(page.locator('.segment-card')).toHaveCount(3);
  await page.getByRole('button',{name:'依累積消費排序'}).click();
  const totals=await page.locator('.member-table tbody tr td:nth-child(5)').allInnerTexts();
  const values=totals.map(text=>Number(text.replace(/\D/g,'')));
  expect([...values].sort((a,b)=>b-a)).toEqual(values);
  await page.locator('.segment-card.potential').getByRole('button',{name:/推播優惠/}).click();
  await page.locator('#campaign-title').fill(`驗收推播-${Date.now()}`);
  await page.getByRole('button',{name:/送出推播/}).click();
  await expect(page.locator('#toast')).toContainText('已推播');
  const latest=(await state(page)).campaigns[0];
  const memberView=(await (await page.request.get(`/api/truck/public?member=${latest.recipients[0]}`)).json()).state;
  expect(memberView.inbox[0].id).toBe(latest.id);
  expect(memberView.offers.some(o=>o.code===latest.couponCode)).toBe(true);
  await page.locator('.bell-button').click();
  await expect(page.locator('.notify-popover')).toBeVisible();
  await page.locator('.notify-tabs').getByRole('tab',{name:/訂單/}).click();
  await expect(page.locator('.notify-tabs [aria-selected="true"]')).toContainText('訂單');
});

test('a new truck registers as its own account and the merchant can switch back',async({page})=>{
  await login(page);
  const username=`truck${Date.now()}`;
  await page.goto('/register?add=1');
  await page.locator('#register-name').fill('驗收咖哩餐車');
  await page.locator('#register-username').fill(username);
  await page.locator('#register-password').fill('acceptance-pass');
  await page.locator('#register-confirm').fill('acceptance-pass');
  await page.getByRole('button',{name:/建立餐車帳號/}).click();
  await expect(page.locator('.workspace-switch')).toContainText('驗收咖哩餐車',{timeout:20000});
  await expect(page.locator('.onboarding')).toBeVisible();
  expect((await state(page)).menu).toEqual([]);
  await page.locator('.workspace-switch').click();
  await page.locator('.switch-row').filter({hasText:'海海人生行動餐車'}).click();
  await expect(page.locator('.workspace-switch')).toContainText('海海人生',{timeout:20000});
  // Sign the test truck out again so the shared browser list stays tidy.
  await page.locator('.workspace-switch').click();
  await page.locator('.switch-row').filter({hasText:'驗收咖哩餐車'}).click();
  await expect(page.locator('.workspace-switch')).toContainText('驗收咖哩餐車',{timeout:20000});
  await page.locator('.account-button').click();
  await page.getByRole('menuitem',{name:/登出這台餐車/}).click();
  await expect(page.locator('.workspace-switch')).toContainText('海海人生',{timeout:20000});
});
