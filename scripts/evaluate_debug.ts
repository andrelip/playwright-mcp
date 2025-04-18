import { chromium } from 'playwright';
import evaluateTool from '../src/tools/evaluate';

(async () => {
  // Launch browser and open a new page
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com'); // Simple page for JS eval

  // Mock the MCP context object minimally for the tool
  const mcpContext = {
    currentTabOrDie: () => ({ page })
  } as any;

  // Prepare params for the evaluate tool
  const params = { script: '1+1' };

  // Run the evaluate tool's handle function
  const result = await evaluateTool[0].handle(mcpContext, params);

  // Print the entire result object
  console.log('Evaluate Tool Result:', result);

  await browser.close();
})();
