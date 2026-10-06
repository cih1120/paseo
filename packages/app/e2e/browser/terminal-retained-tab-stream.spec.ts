import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { TerminalE2EHarness } from "../support/helpers/terminal-dsl";

interface AttachOverlayProbeWindow extends Window {
  __terminalAttachOverlaySeen?: boolean;
  __terminalAttachOverlayObserver?: MutationObserver;
}

async function watchForTerminalAttachOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as AttachOverlayProbeWindow;
    win.__terminalAttachOverlaySeen = false;
    win.__terminalAttachOverlayObserver?.disconnect();
    win.__terminalAttachOverlayObserver = new MutationObserver(() => {
      if (document.querySelector('[data-testid="terminal-attach-loading"]')) {
        win.__terminalAttachOverlaySeen = true;
      }
    });
    win.__terminalAttachOverlayObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

async function terminalAttachOverlayWasSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const win = window as AttachOverlayProbeWindow;
    win.__terminalAttachOverlayObserver?.disconnect();
    return win.__terminalAttachOverlaySeen === true;
  });
}

test.describe("retained terminal tab streams", () => {
  let harness: TerminalE2EHarness;

  test.beforeEach(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-retained-tab-stream-" });
  });

  test.afterEach(async () => {
    await harness.cleanup();
  });

  test("switching back to a retained terminal does not reattach its stream", async ({ page }) => {
    const first = await harness.createTerminal({ name: "retained-first" });
    const second = await harness.createTerminal({ name: "retained-second" });

    await harness.openTerminal(page, { terminalId: first.id });
    const secondTab = page.getByTestId(`workspace-tab-terminal_${second.id}`).first();
    await secondTab.click();
    await expect(page.getByTestId("terminal-attach-loading")).toBeHidden({ timeout: 10_000 });

    await watchForTerminalAttachOverlay(page);
    await page.getByTestId(`workspace-tab-terminal_${first.id}`).first().click();
    await expect(page.getByTestId("terminal-surface").filter({ visible: true })).toHaveCount(1);
    await page.waitForTimeout(100);

    expect(await terminalAttachOverlayWasSeen(page)).toBe(false);
  });

  test("workspace number shortcuts refocus a retained terminal", async ({ page }) => {
    const first = await harness.createTerminal({ name: "focus-first" });
    const other = await TerminalE2EHarness.create({ tempPrefix: "terminal-workspace-focus-" });
    try {
      const second = await other.createTerminal({ name: "focus-second" });
      await harness.openTerminal(page, { terminalId: first.id });
      await other.openTerminal(page, { terminalId: second.id });
      const rows = page
        .locator('[data-testid^="sidebar-workspace-row-"]')
        .filter({ visible: true });
      const rowIds = await rows.evaluateAll((elements) => {
        const ids: Array<string | null> = [];
        for (const element of elements) ids.push(element.getAttribute("data-testid"));
        return ids;
      });
      const firstIndex = rowIds.findIndex((id) => id?.endsWith(`:${harness.workspaceId}`)) + 1;
      const secondIndex = rowIds.findIndex((id) => id?.endsWith(`:${other.workspaceId}`)) + 1;
      expect(firstIndex).toBeGreaterThan(0);
      expect(secondIndex).toBeGreaterThan(0);
      const terminalInput = page
        .getByTestId("terminal-surface")
        .filter({ visible: true })
        .locator("textarea");
      await expect(terminalInput).toBeFocused();
      // Browser Alt+Digit routes the same workspace action as desktop Cmd+Digit.
      await page.keyboard.press(`Alt+${firstIndex}`);
      await expect(page).toHaveURL(new RegExp(`/workspace/${harness.workspaceId}`));
      await expect(terminalInput).toBeFocused();
      await page.keyboard.press(`Alt+${secondIndex}`);
      await expect(page).toHaveURL(new RegExp(`/workspace/${other.workspaceId}`));
      await expect(terminalInput).toBeFocused();
      await page.keyboard.type("printf 'WORKSPACE_FOCUS_OK\\n'");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await other.client.captureTerminal(second.id)).lines)
        .toContain("WORKSPACE_FOCUS_OK");
    } finally {
      await other.cleanup();
    }
  });
});
