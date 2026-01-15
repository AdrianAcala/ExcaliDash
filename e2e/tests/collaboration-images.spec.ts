import { test, expect } from "@playwright/test";
import path from "path";

const apiBaseURL = process.env.E2E_API_URL || "http://localhost:8000";

const createDrawing = async (request: any, name: string) => {
  const response = await request.post(`${apiBaseURL}/drawings`, {
    data: {
      name,
      elements: [],
      appState: {},
      files: {},
    },
  });

  expect(response.ok()).toBeTruthy();
  return response.json();
};

const deleteDrawing = async (request: any, id: string) => {
  await request.delete(`${apiBaseURL}/drawings/${id}`).catch(() => undefined);
};

test.describe("Collaboration images", () => {
  let drawingId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (drawingId) {
      await deleteDrawing(request, drawingId);
      drawingId = null;
    }
  });

  test("should sync new image files without refresh", async ({ browser, request }, testInfo) => {
    const drawing = await createDrawing(request, `Collab_Image_${Date.now()}`);
    drawingId = drawing.id;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await page1.goto(`/editor/${drawingId}`);
      await page2.goto(`/editor/${drawingId}`);

      await page1.waitForSelector("canvas", { timeout: 15000 });
      await page2.waitForSelector("canvas", { timeout: 15000 });

      await page1.waitForFunction(() => !!(window as any).__EXCALIDRAW_API__);
      await page2.waitForFunction(() => !!(window as any).__EXCALIDRAW_API__);

      const fixturePath = path.join(testInfo.project.testDir, "..", "fixtures", "small-image.svg");

      const fileInput = page1.locator("input[type='file']");
      if (await fileInput.count()) {
        await fileInput.first().setInputFiles(fixturePath);
      } else {
        const imageButton = page1.getByRole("button", { name: /image|insert image/i });
        if (await imageButton.count()) {
          const [chooser] = await Promise.all([
            page1.waitForEvent("filechooser"),
            imageButton.first().click(),
          ]);
          await chooser.setFiles(fixturePath);
        } else {
          throw new Error("Image input not found in editor UI");
        }
      }

      await page1.waitForFunction(() => {
        const api = (window as any).__EXCALIDRAW_API__;
        const files = api?.getFiles?.() || {};
        return Object.keys(files).length > 0;
      }, { timeout: 10000 });

      await page2.waitForFunction(() => {
        const api = (window as any).__EXCALIDRAW_API__;
        const files = api?.getFiles?.() || {};
        return Object.keys(files).length > 0;
      }, { timeout: 10000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
