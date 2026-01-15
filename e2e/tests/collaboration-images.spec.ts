/// <reference types="node" />
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

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

const waitForEditorReady = async (page: any) => {
  await page.waitForSelector("canvas.excalidraw__canvas.interactive", {
    timeout: 15000,
  });
  await page.waitForFunction(() => !!(window as any).__EXCALIDRAW_API__);
};

const waitForImageAndFiles = async (page: any) => {
  await page.waitForFunction(() => {
    const api = (window as any).__EXCALIDRAW_API__;
    const files = api?.getFiles?.() || {};
    const hasImage = api?.getSceneElements?.().some((el: any) => el?.type === "image");
    return hasImage && Object.keys(files).length > 0;
  });
};

const waitForFileData = async (page: any, fileIds: string[]) => {
  await expect.poll(
    async () => {
      return page.evaluate((ids: string[]) => {
        const api = (window as any).__EXCALIDRAW_API__;
        const files = api?.getFiles?.() || {};
        return ids.every((id) => !!files?.[id]?.dataURL);
      }, fileIds);
    },
    { timeout: 15000 }
  ).toBe(true);
};

const addImageToPage = async (page: any, dataURL: string) => {
  return page.evaluate((payload) => {
    const api = (window as any).__EXCALIDRAW_API__;
    if (!api) throw new Error("Excalidraw API not available");

    const now = Date.now();
    const fileId = `file_${now}`;
    const imageElement = {
      type: "image",
      id: `img_${now}`,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      angle: 0,
      strokeColor: "#000000",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roundness: null,
      roughness: 0,
      opacity: 100,
      seed: Math.floor(Math.random() * 1000000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      index: null,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: now,
      link: null,
      locked: false,
      status: "saved",
      fileId,
      scale: [1, 1],
      crop: null,
    };

    api.addFiles([
      {
        mimeType: "image/svg+xml",
        id: fileId,
        dataURL: payload,
        created: now,
        lastRetrieved: now,
      },
    ]);

    const existing =
      api.getSceneElementsIncludingDeleted?.() || api.getSceneElements?.() || [];
    api.updateScene({
      elements: [...existing, imageElement],
    });

    return fileId;
  }, dataURL);
};

test.describe("Collaboration images", () => {
  let drawingId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (drawingId) {
      await deleteDrawing(request, drawingId);
      drawingId = null;
    }
  });

  test("should sync new image files without refresh", async ({ browser, request }) => {
    const drawing = await createDrawing(request, `Collab_Image_${Date.now()}`);
    drawingId = drawing.id;
    const imagePath = path.resolve(__dirname, "../fixtures/small-image.svg");
    const imageData = fs.readFileSync(imagePath, "utf-8");
    const testImageDataURL =
      "data:image/svg+xml;base64," + Buffer.from(imageData).toString("base64");

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await page1.goto(`/editor/${drawingId}`);
      await page2.goto(`/editor/${drawingId}`);

      await waitForEditorReady(page1);
      await waitForEditorReady(page2);

      // Wait a bit for socket connections to establish
      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Add image element using Excalidraw API on page1
      const fileId = await addImageToPage(page1, testImageDataURL);

      await waitForImageAndFiles(page1);

      // Check if image synced to page2 (this is what we're testing)
      await waitForFileData(page2, [fileId]);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("should load existing image for a new client on initial load and after reload", async ({
    browser,
    request,
  }) => {
    const drawing = await createDrawing(request, `Collab_Image_Third_${Date.now()}`);
    drawingId = drawing.id;
    const imagePath = path.resolve(__dirname, "../fixtures/small-image.svg");
    const imageData = fs.readFileSync(imagePath, "utf-8");
    const testImageDataURL =
      "data:image/svg+xml;base64," + Buffer.from(imageData).toString("base64");

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    try {
      await page1.goto(`/editor/${drawingId}`);
      await page2.goto(`/editor/${drawingId}`);

      await waitForEditorReady(page1);
      await waitForEditorReady(page2);

      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      const fileId = await addImageToPage(page1, testImageDataURL);

      await waitForImageAndFiles(page1);
      await waitForFileData(page2, [fileId]);

      await expect.poll(
        async () => {
          const response = await request.get(`${apiBaseURL}/drawings/${drawingId}`);
          const data = await response.json();
          return !!data?.files?.[fileId]?.dataURL;
        },
        { timeout: 15000 }
      ).toBe(true);

      await page3.goto(`/editor/${drawingId}`);
      await waitForEditorReady(page3);
      await page3.waitForTimeout(2000);

      await expect.poll(
        async () => {
          return page3.evaluate((id: string) => {
            const api = (window as any).__EXCALIDRAW_API__;
            const files = api?.getFiles?.() || {};
            const hasImage = api?.getSceneElements?.().some((el: any) => el?.type === "image");
            return hasImage && !!files?.[id]?.dataURL;
          }, fileId);
        },
        { timeout: 15000 }
      ).toBe(true);

      await page3.reload();
      await waitForEditorReady(page3);
      await page3.waitForTimeout(2000);

      await expect.poll(
        async () => {
          return page3.evaluate((id: string) => {
            const api = (window as any).__EXCALIDRAW_API__;
            const files = api?.getFiles?.() || {};
            const hasImage = api?.getSceneElements?.().some((el: any) => el?.type === "image");
            return hasImage && !!files?.[id]?.dataURL;
          }, fileId);
        },
        { timeout: 15000 }
      ).toBe(true);
    } finally {
      await context1.close();
      await context2.close();
      await context3.close();
    }
  });
});
