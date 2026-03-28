// background.js — ChatGPT Branch Explorer
// Listens for the extension toolbar icon click and tells the content script to toggle the sidebar.

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "GBX_TOGGLE_SIDEBAR" });
});
