// Chrome real + backend isolado. Não chama conectar na Evolution real.
// PLAYWRIGHT_MODULE=/tmp/.../node_modules/playwright-core node tests/e2e/whatsapp.browser.cjs
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://localhost:55173/whatsapp.html");
    await page.locator("#login").waitFor({ state: "visible" });
    await page.locator("#email").fill("admin.evolution@example.test");
    await page.locator("#senha").fill("Validacao-Isolada-9503!");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.locator("#painel").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#api-status").textContent !== "Verificando…");
    assert.match(await page.locator("#instance").textContent(), /agroalerta/);
    assert.match(await page.locator("#sending").textContent(), /WHATSAPP_SENDING_ENABLED=false/);
    assert.equal(await page.locator("#welcome").textContent(), "Desativadas");
    assert.equal(await page.locator("#frost").textContent(), "Desativados");
    assert.equal(await page.locator("#qr").isVisible(), false);

    const response = await context.request.get("http://localhost:3301/api/admin/whatsapp", {
      headers: { Authorization: "Bearer " + await page.evaluate(() => sessionStorage.getItem("agroalerta_token")) },
    });
    const realState = await response.json();
    assert.equal(response.status(), 200);
    assert.equal(realState.evolution.disponivel, true, "Backend deve alcançar a Evolution real.");
    assert.equal(realState.conexao.existe, true);
    assert.equal(realState.envioLiberado, false);

    // QR fictício e evento de conexão simulados só no navegador.
    const qr = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=";
    let intercepted = 0;
    await page.route("**/api/admin/whatsapp/conectar", async (route) => {
      intercepted++;
      await route.fulfill({ json: { ...realState, conexao: { ...realState.conexao, estado: "connecting", qrCode: qr } } });
    });
    await page.route(/\/api\/admin\/whatsapp$/, (route) => route.fulfill({
      json: { ...realState, conexao: { ...realState.conexao, estado: "connecting", qrCode: qr } },
    }));
    await page.getByRole("button", { name: "Conectar e mostrar QR Code" }).click();
    await page.locator("#qr").waitFor({ state: "visible" });
    assert.equal(intercepted, 1);
    assert.equal(await page.locator("#qr").getAttribute("src"), qr);
    assert.match(await page.locator("#connection").textContent(), /Aguardando pareamento/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Página deve caber na tela móvel.");
    await page.screenshot({ path: "/tmp/agroalerta-whatsapp-mobile.png", fullPage: true });
    await context.close();

    const producer = await browser.newPage();
    await producer.goto("http://localhost:55173/whatsapp.html");
    await producer.locator("#email").fill("produtor.evolution@example.test");
    await producer.locator("#senha").fill("Validacao-Isolada-9503!");
    await producer.getByRole("button", { name: "Entrar", exact: true }).click();
    await producer.waitForFunction(() => document.querySelector("#feedback").textContent.includes("não possui permissão"));
    assert.equal(await producer.locator("#painel").isVisible(), false);
    const forbidden = await producer.request.get("http://localhost:3301/api/admin/whatsapp");
    assert.equal(forbidden.status(), 401);
    assert.deepEqual(errors, []);
    console.log("E2E aprovado: login admin, backend→Evolution real, bloqueios, QR simulado, layout móvel e produtor sem acesso. Nenhum pareamento ou envio real.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
