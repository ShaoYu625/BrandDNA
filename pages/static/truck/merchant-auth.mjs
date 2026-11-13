// Merchant accounts: one food truck = one account. Login (with previously used accounts), registration and truck switching.
import { esc, icon } from './client.mjs';
import { ui, initial, logo } from './merchant-ui.mjs';

const KNOWN_KEY = 'branddna.truck.known.v1';
/** The flagship truck is listed (with its initial password) on a fresh browser so the team can sign in with one click. */
const FLAGSHIP = { slug: 'haihai', name: '海海人生行動餐車', username: 'haihai', password: 'haihai2026' };

/** Accounts used on this device. `password` is only kept when the merchant ticked 「記住密碼」. */
export function knownAccounts() {
  let list = null;
  try { list = JSON.parse(localStorage.getItem(KNOWN_KEY)); } catch { /* fall back below */ }
  if (!Array.isArray(list)) list = [FLAGSHIP];
  return list.filter(row => row && row.username).slice(0, 8);
}
function saveKnown(list) {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* private mode */ }
}
/** password: a string saves it, null forgets it, undefined keeps whatever this device already saved. */
export function rememberAccount(account, password) {
  if (!account?.username) return;
  const known = knownAccounts();
  const saved = password === undefined ? known.find(row => row.username === account.username)?.password : password || '';
  saveKnown([{ slug: account.slug, name: account.name, username: account.username, ...(saved ? { password: saved } : {}) }, ...known.filter(row => row.username !== account.username)]);
}
export const savedPassword = username => knownAccounts().find(row => row.username === username)?.password || '';
export function forgetPassword(username) {
  saveKnown(knownAccounts().map(row => {
    if (row.username !== username) return row;
    const { password, ...rest } = row;
    return rest;
  }));
}
export function forgetAccount(username) {
  saveKnown(knownAccounts().filter(row => row.username !== username));
}
const rememberBox = (checked = true) => `<label class="inline-toggle auth-remember"><input type="checkbox" name="remember" ${checked ? 'checked' : ''}>在這台裝置記住密碼，下次點帳號就自動填好</label>`;

function aside() {
  return `<aside class="auth-aside"><a class="logo light" href="/login">${logo()}BrandDNA<span class="beta">TRUCK</span></a>
    <h1>把餐車的品牌、<br>訂單和會員<br>放在同一個地方。</h1>
    <ul class="auth-points">${[['pen', 'AI 依品牌語氣寫貼文，三天沒發文會主動提醒'], ['shopping-bag', '顧客掃碼點餐，接單進度即時同步'], ['users', '會員分群推播優惠與專屬折扣碼'], ['globe', '中英文菜單，一鍵切換']].map(([i, text]) => `<li>${icon(i, 16)}<span>${text}</span></li>`).join('')}</ul>
    <p class="auth-foot">一台餐車一個帳號 · 可隨時切換餐車</p></aside>`;
}

/** mode: login | register. `signedIn` lists trucks this browser is already signed in to. */
export function authScreen(mode, { signedIn = [], adding = false, prefill = '', error = '' } = {}) {
  const known = knownAccounts();
  const signed = new Set(signedIn.map(row => row.username));
  const back = adding && signedIn.length ? `<a class="text-link auth-back" href="/dashboard">${icon('arrow-left', 13)} 回到工作台</a>` : '';
  if (mode === 'register') {
    return `<div class="auth-shell">${aside()}<main class="auth-main"><section class="auth-card">${back}
      <h2>註冊新餐車</h2><p class="body-copy">一台餐車一個帳號。註冊後會建立全新的工作台，之後可以在左上角快速切換餐車。</p>
      <form id="register-form" class="auth-form"><div class="field"><label for="register-name">餐車店名</label><input id="register-name" name="storeName" maxlength="40" required autocomplete="organization" placeholder="例如：小島咖哩餐車"><small>店名就是帳號名稱，顧客點餐頁也會顯示。</small></div>
        <div class="field"><label for="register-username">帳號</label><input id="register-username" name="username" maxlength="32" required autocomplete="username" pattern="[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,31}" placeholder="英文或數字，例如 island.curry"></div>
        <div class="grid cols-2 form-grid"><div class="field"><label for="register-password">密碼</label><input id="register-password" name="password" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></div>
        <div class="field"><label for="register-confirm">再輸入一次</label><input id="register-confirm" name="confirm" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></div></div>
        ${rememberBox()}
        <button class="btn primary auth-submit" type="submit">建立餐車帳號 ${icon('arrow-right', 14)}</button><p class="modal-error" role="alert">${esc(error)}</p></form>
      <p class="auth-switch">已經有帳號了？<a href="/login${adding ? '?add=1' : ''}">登入</a></p></section></main></div>`;
  }
  return `<div class="auth-shell">${aside()}<main class="auth-main"><section class="auth-card">${back}
    <h2>${adding ? '登入其他餐車' : '登入餐車工作台'}</h2>
    ${known.length ? `<div class="known-accounts"><p class="eyebrow muted">先前登入的帳號</p>${known.map(row => `<div class="known-row"><button class="known-account" data-action="known-account" data-username="${esc(row.username)}" data-slug="${esc(row.slug || '')}"><span class="avatar">${initial(row.name)}</span><span><strong>${esc(row.name)}</strong><small>@${esc(row.username)}${row.password ? ' · 已記住密碼' : ''}</small></span>${signed.has(row.username) ? '<span class="badge approved">已登入</span>' : icon('chevron', 13)}</button><button class="icon-button" data-action="known-forget" data-username="${esc(row.username)}" aria-label="從清單移除 ${esc(row.name)}">${icon('close', 14)}</button></div>`).join('')}</div>` : ''}
    <form id="login-form" class="auth-form"><div class="field"><label for="login-username">帳號</label><input id="login-username" name="username" maxlength="64" required autocomplete="username" value="${esc(prefill)}"></div>
      <div class="field"><label for="login-password">密碼</label><input id="login-password" name="password" type="password" maxlength="128" required autocomplete="current-password"><small id="login-saved-hint" hidden>已填入這台裝置記住的密碼，直接按「登入」即可。</small></div>
      ${rememberBox()}
      <button class="btn primary auth-submit" type="submit">登入 ${icon('arrow-right', 14)}</button><p class="modal-error" role="alert">${esc(error)}</p></form>
    <p class="auth-switch">還沒有帳號？<a href="/register${adding ? '?add=1' : ''}">註冊新餐車</a></p></section></main></div>`;
}

/** Sidebar truck switcher (the workspace button): switching trucks = switching accounts. */
export function switcherPanel() {
  const current = ui.account;
  return `<div class="popover switcher-popover" role="menu" aria-label="切換餐車"><p class="eyebrow muted">已登入的餐車</p>
    ${ui.accounts.map(row => `<button class="switch-row ${row.slug === current?.slug ? 'current' : ''}" role="menuitem" data-action="truck-switch" data-slug="${esc(row.slug)}"><span class="workspace-avatar small">${initial(row.name)}</span><span><strong>${esc(row.name)}</strong><small>@${esc(row.username)}</small></span>${row.slug === current?.slug ? icon('check', 14) : ''}</button>`).join('')}
    <div class="popover-sep"></div>
    <a class="switch-link" role="menuitem" href="/login?add=1">${icon('plus', 14)} 登入其他餐車</a>
    <a class="switch-link" role="menuitem" href="/register?add=1">${icon('truck', 14)} 註冊新餐車</a></div>`;
}

/** Top-right account menu (the only profile control in the shell). */
export function accountMenu() {
  const current = ui.account;
  return `<div class="popover account-popover" role="menu" aria-label="帳號"><div class="account-head"><span class="avatar">${initial(current?.name)}</span><span><strong>${esc(current?.name || '')}</strong><small>@${esc(current?.username || '')}</small></span></div>
    <a class="switch-link" role="menuitem" href="/settings">${icon('settings', 14)} 工作區設定</a>
    <a class="switch-link" role="menuitem" href="/guide">${icon('book', 14)} 使用教學</a>
    <button class="switch-link" role="menuitem" data-action="password-open">${icon('lock', 14)} 變更密碼</button>
    ${ui.accounts.length > 1 ? `<button class="switch-link" role="menuitem" data-action="popover" data-popover="switcher">${icon('swap', 14)} 切換餐車</button>` : ''}
    <div class="popover-sep"></div>
    <button class="switch-link danger" role="menuitem" data-action="logout">${icon('logout', 14)} 登出這台餐車</button>
    ${ui.accounts.length > 1 ? `<button class="switch-link danger" role="menuitem" data-action="logout-all">${icon('logout', 14)} 登出全部餐車</button>` : ''}</div>`;
}
