import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  timeout:60000,
  fullyParallel:false,
  workers:1,
  use:{baseURL:process.env.DEMO_URL||'http://127.0.0.1:8788',browserName:'chromium',channel:'chrome',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:[['list']],
});
