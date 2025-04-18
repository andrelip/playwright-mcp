import { test, expect } from '@playwright/test';
import { createServer } from '../src/index';

// This is a basic integration test for the evaluate tool

test.describe('browser_evaluate_javascript', () => {
  let server: any;

  test.beforeAll(async () => {
    server = await createServer();
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test('should evaluate simple JavaScript and return result', async () => {
    // This is a placeholder: you may need to adapt this section to your actual test harness
    const context = await server.createContext();
    const tab = await context.newTab('about:blank');
    const result = await tab.page.evaluate('1 + 2');
    expect(result).toBe(3);
  });

  test('should evaluate JavaScript with DOM access', async () => {
    const context = await server.createContext();
    const tab = await context.newTab('data:text/html,<div id=foo>bar</div>');
    const result = await tab.page.evaluate("document.getElementById('foo').textContent");
    expect(result).toBe('bar');
  });
});
