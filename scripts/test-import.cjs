// Requires Playwright and a running static server. TEST_URL defaults to localhost.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:8080/studio/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__paperStudioDebug.recoveryReady);

    async function pdfFile(name, pages) {
      const data = await page.evaluate((count) => {
        const pdf = new window.jspdf.jsPDF();
        for (let number = 1; number <= count; number += 1) {
          if (number > 1) pdf.addPage();
          pdf.text(`Original page ${number}`, 20, 25);
          pdf.text("Math question for import verification", 20, 40);
        }
        return pdf.output("datauristring").split(",")[1];
      }, pages);
      return { name, mimeType: "application/pdf", buffer: Buffer.from(data, "base64") };
    }

    async function choose(files) {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator("#addFilesButton").click();
      const chooser = await chooserPromise;
      assert.equal(chooser.isMultiple(), true);
      await chooser.setFiles(files);
      await page.waitForFunction(() => !document.querySelector("#confirmImportButton").disabled);
    }

    async function selectRange(index, start, end) {
      const row = page.locator(".import-file").nth(index);
      await row.locator('input[value="range"]').check();
      await row.locator("[data-range-start]").fill(String(start));
      await row.locator("[data-range-end]").fill(String(end));
    }

    async function confirm(count) {
      await page.locator("#confirmImportButton").click();
      await page.waitForFunction(() => !document.querySelector("#importDialog").open);
      await page.waitForFunction((expected) => window.__paperStudioDebug.documents.length === expected, count);
    }

    const large = await pdfFile("first-339-pages.pdf", 339);
    const second = await pdfFile("second-8-pages.pdf", 8);
    await choose(large);
    await confirm(1);
    assert.equal(await page.locator(".continuous-page").count(), 339);
    assert.equal(await page.locator("#uploadSectionBody").isHidden(), true);

    // Add another file while the first file has hundreds of thumbnails.
    await choose(second);
    await selectRange(0, 6, 4);
    await page.locator("#confirmImportButton").click();
    assert.equal(await page.locator("#importError").isVisible(), true);
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.documents.length), 1);
    await selectRange(0, 3, 5);
    await confirm(2);
    assert.equal(await page.locator("#pageTitle").textContent(), second.name);
    assert.deepEqual(await page.locator(".page-thumb").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.page))), [3, 4, 5]);
    assert.deepEqual(await page.locator(".continuous-page").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.continuousPage))), [3, 4, 5]);
    for (const button of await page.locator("[data-open-document]").all()) assert.equal(await button.isVisible(), true);
    assert.equal(await page.locator("#prevPageButton").isDisabled(), true);
    await page.waitForSelector('[data-continuous-page="3"] .selection-layer');
    const layer = await page.locator('[data-continuous-page="3"] .selection-layer').boundingBox();
    await page.mouse.move(layer.x + 60, layer.y + 90);
    await page.mouse.down();
    await page.mouse.move(layer.x + 400, layer.y + 220, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__paperStudioDebug.questions.length === 1);
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.questions[0].sourcePage), 3);
    await page.locator("#nextPageButton").click();
    await page.waitForFunction(() => window.__paperStudioDebug.activePage === 4);
    await page.locator("#nextPageButton").click();
    await page.waitForFunction(() => window.__paperStudioDebug.activePage === 5);
    assert.equal(await page.locator("#nextPageButton").isDisabled(), true);

    // One chooser can import several PDFs with different page ranges.
    const third = await pdfFile("third-12-pages.pdf", 12);
    const fourth = await pdfFile("fourth-4-pages.pdf", 4);
    await choose([third, fourth]);
    await selectRange(0, 10, 12);
    await selectRange(1, 2, 2);
    if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT });
    await confirm(4);
    assert.equal(await page.locator(".continuous-page").count(), 3);
    const fourthId = await page.evaluate(() => window.__paperStudioDebug.documents[3].id);
    await page.locator(`[data-open-document="${fourthId}"]`).click();
    await page.waitForSelector('[data-continuous-page="2"] canvas');
    assert.equal(await page.locator(".continuous-page").count(), 1);
    assert.equal(await page.locator("#prevPageButton").isDisabled(), true);
    assert.equal(await page.locator("#nextPageButton").isDisabled(), true);

    // Selecting the same file again still opens the range dialog; cancel keeps work.
    await choose(second);
    await page.locator("#cancelImportButton").click();
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.documents.length), 4);
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.questions.length), 1);

    await page.waitForFunction(() => window.__paperStudioDebug.documents.every((document) => document.sourceCached));
    await page.waitForFunction(() => document.querySelector("#saveStatus").textContent.includes("最近进度已保存"));
    const before = await page.evaluate(() => ({
      ranges: window.__paperStudioDebug.documents.map((document) => [document.pageStart, document.pageEnd]),
      question: window.__paperStudioDebug.questions[0].id,
    }));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__paperStudioDebug.recoveryReady);
    assert.deepEqual(await page.evaluate(() => window.__paperStudioDebug.documents.map((document) => [document.pageStart, document.pageEnd])), before.ranges);
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.questions[0].id), before.question);
    assert.equal(await page.locator(".continuous-page").count(), 1);
    assert.equal(await page.locator("#pageCounter").textContent(), "2 / 4");

    // A damaged PDF does not prevent other files in the same batch being added.
    await choose([{ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") }, fourth]);
    assert.match(await page.locator(".import-file").first().textContent(), /无法读取/);
    await confirm(5);
    assert.equal(await page.evaluate(() => window.__paperStudioDebug.questions.length), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, documents: 5, ranges: before.ranges, questionSourcePage: 3, refreshRestored: true, errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
