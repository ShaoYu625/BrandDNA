# BrandDNA Foodtruck Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the tasks with independent review.

**Goal:** 完成商家品牌到排程、顧客點餐到接單的可操作 Demo。

**Architecture:** 既有 Pages/Workers 基底，獨立 truck API 與前端 ES modules，D1 共用狀態、R2 自拍照片。

**Tech Stack:** Nunjucks, native CSS/JS, TypeScript, Cloudflare D1/R2, node:test, Playwright.

**Spec:** ../specs/2026-11-05-foodtruck-design.md

## Global Constraints

- 使用者明確授權直接修改目前基底、設計由實作者決定。
- 品牌：新巨輪－海海人生行動餐車；實際資訊與示範資料須區分。
- 保留既有分析 API；新版市場模擬移除、規範檢查不阻擋。
- 所有外部 LINE/Meta 操作與成效均為模擬；後續使用者授權部署獨立 Cloudflare 專案。

## Review Focus

- 文案修改後不得沿用已確認狀態。
- 訂單金額以後端菜單計算，數量與轉態需驗證。
- 同時操作不得遺失其他裝置的新訂單。
- 網路失敗不得顯示成功或吞掉使用者輸入。
- 手機 390px 與桌面畫面可讀，QR 使用目前同源網址。

## Tasks

- [x] 1. Backend: `api/src/routes/truck.ts`、migration、domain tests。API GET state / POST actions、照片、共享持久化、狀態驗證。先失敗測試再實作，執行 node tests/typecheck。
- [x] 2. Shared client + merchant: `pages/static/truck/client.mjs`、`merchant.mjs`、`merchant.css`、新範本與 render routes。先驗證 client 錯誤與狀態同步，再完成 dashboard/data/diagnosis/posts/calendar/orders/analytics/settings。
- [x] 3. Customer: `customer.mjs`、`customer.css`，手機會員、選餐、購物車、送單、持續訂單狀態；與商家同用 client/API。
- [x] 4. Brand evidence: 官方介紹與圖片來源註記；歷史菜單與價格、營業場次清楚標為示範。
- [x] 5. Integration: 本機 migration/render/typecheck/node tests，Playwright 兩條流程與手機尺寸，截圖檢視、獨立程式審查，更新 README Demo 操作。

## Progress

Initial audit: baseline typecheck passed; no Git or AGENTS found. Backend/customer tasks delegated with exact state/action contracts. Brand research delegated. No product edits before explicit design delegation in original request. Native integration and UI implemented by root.
