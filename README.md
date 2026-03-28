# ChatGPT Branch Explorer

A Chrome extension that adds a visual branch tree sidebar to ChatGPT, and a "Fork branch here" option when you select text.

---

## What it does

**Sidebar** — Click the tab on the right edge of the screen to open the Branch Explorer panel. It scans the current conversation for ChatGPT's built-in branch points (the `‹ 1/2 ›` arrows) and renders them as a clear tree. Click any variant in the tree to navigate directly to it — no more hunting through arrows message by message.

**Selection menu** — Select any text in the chat. A small floating menu appears with:
- **Fork branch here** — triggers ChatGPT's native edit flow on that message, pre-filled with context about your selection, creating a new branch automatically
- **What's a branch?** — inline explanation for new users

No API key. No OpenAI account changes. Works entirely on top of chatgpt.com.

---

## How branches actually work

ChatGPT already has a branching system. When you edit a past message, it saves the original conversation thread and starts a new one from that point — both are preserved server-side. The `‹ 1/2 ›` arrows that appear let you switch between them. This extension just gives you a better map of the whole tree.

---

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `chatgpt-branch-explorer` folder (the one containing `manifest.json`)
5. Visit [chatgpt.com](https://chatgpt.com) — you'll see the branch tab on the right edge

To update after making code changes: click the refresh icon on the extension card in `chrome://extensions`.

---

## File structure

```
chatgpt-branch-explorer/
├── manifest.json       # Extension config
├── content.js          # DOM scanner, sidebar logic, selection menu
├── sidebar.css         # All styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
```

> **Note:** The `icons/` folder is referenced in `manifest.json` but not included. Chrome will show a default puzzle-piece icon until you add PNGs. You can generate them from any SVG or use a placeholder.

---

## Known limitations

- ChatGPT's DOM selectors (e.g. `data-testid`, button `aria-label`s) can change when OpenAI ships updates. If the tree stops detecting branches, the selectors in `content.js` near the top of `scanBranchTree()` may need updating.
- The sidebar does not replay or cache message content — it reads live from the DOM. If you navigate away and back, click **Refresh tree**.
- Text selection menu only appears inside the conversation area, not in the sidebar or input box.

---

## Next steps (if you want to extend it)

- [ ] Branch labels / nicknames (stored in `chrome.storage.local`)
- [ ] Export branch tree as markdown
- [ ] Keyboard shortcut to toggle sidebar (`Alt+B`)
- [ ] Auto-open sidebar when a new branch is detected
