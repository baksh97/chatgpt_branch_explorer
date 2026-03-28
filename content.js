/**
 * content.js — ChatGPT Branch Explorer
 *
 * Fixes in this version:
 *  1. Toggle button is ALWAYS visible. Sidebar never auto-hides.
 *  2. "Fork from here" button injected on every USER message turn.
 *  3. Selection menu works on both user AND assistant messages.
 *     - User message selected   → triggers native edit, pre-fills text
 *     - Assistant message selected → prefills bottom input "Explain: <text>"
 *  4. ChatGPT's own "Ask ChatGPT" popup is suppressed. Ours replaces it,
 *     and includes an "Ask ChatGPT" button of our own.
 */

(() => {
  "use strict";

  // ─── IDs ────────────────────────────────────────────────────────────────────
  const SIDEBAR_ID        = "gbx-sidebar";
  const TOGGLE_ID         = "gbx-toggle";
  const SEL_MENU_ID       = "gbx-sel-menu";

  // ─── ChatGPT DOM selectors ───────────────────────────────────────────────────
  const TURN_SEL      = "[data-testid^='conversation-turn-']";
  const USER_MSG_SEL  = "[data-message-author-role='user']";
  const ASST_MSG_SEL  = "[data-message-author-role='assistant']";
  const EDIT_BTN_SEL  = "button[aria-label='Edit message'], button[data-testid='edit-button'], button[aria-label*='dit' i]";

  // ─── State ───────────────────────────────────────────────────────────────────
  let sidebarOpen   = false;
  let lastTreeLen   = -1;
  let scanTimer     = null;
  let currentView   = "list";   // "list" | "graph"
  // Saved before mousedown clears window.getSelection()
  let saved = { text: "", node: null, isAssistant: false };

  // ════════════════════════════════════════════════════════════════════════════
  // SIDEBAR
  // ════════════════════════════════════════════════════════════════════════════

  function injectSidebar() {
    if (document.getElementById(SIDEBAR_ID)) return;

    const sidebar = document.createElement("div");
    sidebar.id = SIDEBAR_ID;
    sidebar.innerHTML = `
      <div class="gbx-header">
        <span class="gbx-logo">${branchSVG(16)}</span>
        <span class="gbx-title">Branch Explorer</span>
        <button class="gbx-close" id="gbx-close-btn" title="Close">✕</button>
      </div>
      <div class="gbx-info">
        <strong>What are branches?</strong>
        Editing a past message saves the original thread as a branch. The <code>‹ 1/2 ›</code> arrows let you switch. This panel maps your full tree.
      </div>
      <div class="gbx-view-toggle">
        <button class="gbx-view-btn gbx-view-btn--active" id="gbx-view-list" title="List view">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg>
          List
        </button>
        <button class="gbx-view-btn" id="gbx-view-graph" title="Graph view">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="11" x2="17" y2="6"/><line x1="7" y1="13" x2="17" y2="18"/></svg>
          Graph
        </button>
      </div>
      <div id="gbx-graph-wrap"></div>
      <div class="gbx-tree-wrap">
        <div class="gbx-empty" id="gbx-empty">
          <div class="gbx-empty-icon">⑂</div>
          <div class="gbx-empty-msg">No branches yet</div>
          <div class="gbx-empty-sub">Click "Fork from here" on any message to start one.</div>
        </div>
        <ul class="gbx-tree" id="gbx-tree"></ul>
      </div>
      <div class="gbx-footer">
        <button class="gbx-refresh" id="gbx-refresh">↺ Refresh tree</button>
        <button class="gbx-load-all" id="gbx-load-all" title="Visit every branch variant to read its message text">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="7" x2="12" y2="13"/>
          </svg>
          Load all branch names
        </button>
      </div>
    `;
    // Harden sidebar with inline styles as a safety net
    Object.assign(sidebar.style, {
      position:   "fixed",
      top:        "0",
      right:      "0",
      width:      "300px",
      height:     "100vh",
      zIndex:     "2147483647",
      background: "#141414",
      borderLeft: "1px solid #2e2e2e",
      display:    "flex",
      flexDirection: "column",
      visibility: "visible",
      transform:  "translateX(100%)",
      transition: "transform 0.2s cubic-bezier(0.4,0,0.2,1)",
    });
    document.body.appendChild(sidebar);

    const toggle = document.createElement("button");
    toggle.id = TOGGLE_ID;
    toggle.title = "Branch Explorer (click to open)";
    toggle.innerHTML = branchSVG(17);
    // Inline styles as fallback — prevents ChatGPT's CSS from hiding or overriding the button
    Object.assign(toggle.style, {
      position:        "fixed",
      top:             "50%",
      right:           "0",
      transform:       "translateY(-50%)",
      zIndex:          "2147483646",
      width:           "34px",
      height:          "60px",
      display:         "flex",
      alignItems:      "center",
      justifyContent:  "center",
      padding:         "0",
      background:      "#1c1c1c",
      border:          "1px solid #2e2e2e",
      borderRight:     "none",
      borderRadius:    "9px 0 0 9px",
      color:           "#999",
      cursor:          "pointer",
      boxShadow:       "-2px 0 12px rgba(0,0,0,0.4)",
      visibility:      "visible",
      opacity:         "1",
      pointerEvents:   "auto",
    });
    document.body.appendChild(toggle);

    toggle.addEventListener("click", toggleSidebar);
    document.getElementById("gbx-close-btn").addEventListener("click", () => {
      if (sidebarOpen) toggleSidebar();
    });
    document.getElementById("gbx-refresh").addEventListener("click", () => scanAndRender(true));
    document.getElementById("gbx-load-all").addEventListener("click", loadAllBranchNames);

    // View toggle
    document.getElementById("gbx-view-list").addEventListener("click", () => setView("list"));
    document.getElementById("gbx-view-graph").addEventListener("click", () => setView("graph"));
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.getElementById(SIDEBAR_ID);
    const toggle  = document.getElementById(TOGGLE_ID);
    if (sidebar) {
      sidebar.classList.toggle("gbx-open", sidebarOpen);
      // Also drive via inline style so it works even if CSS class is overridden
      sidebar.style.transform = sidebarOpen ? "translateX(0)" : "translateX(100%)";
      sidebar.style.visibility = "visible";
    }
    if (toggle) {
      toggle.classList.toggle("gbx-active", sidebarOpen);
      toggle.style.color = sidebarOpen ? "#5b9cf6" : "#999";
      toggle.style.transform = sidebarOpen
        ? "translateY(-50%) translateX(-3px)"
        : "translateY(-50%)";
    }
    adjustChatLayout(sidebarOpen);
    if (sidebarOpen) scanAndRender(true);
  }

  /**
   * Shrink/restore ChatGPT's main layout container when the sidebar opens.
   * ChatGPT renders everything inside a single full-width div just below body.
   * We find the widest direct child of body that is NOT our own element and
   * add padding-right equal to the sidebar width.
   */
  // Inject a persistent <style> block we can flip on/off.
  // Using a class + !important beats Tailwind's w-screen (width:100vw).
  const GBX_STYLE_ID = "gbx-layout-style";
  const GBX_SHRINK_CLASS = "gbx-shrunk";

  function ensureLayoutStyle() {
    if (document.getElementById(GBX_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = GBX_STYLE_ID;
    style.textContent = `
      .${GBX_SHRINK_CLASS} {
        width: calc(100vw - 300px) !important;
        max-width: calc(100vw - 300px) !important;
        transition: width 0.22s cubic-bezier(0.4,0,0.2,1),
                    max-width 0.22s cubic-bezier(0.4,0,0.2,1) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function findLayoutTarget() {
    // Confirmed via console: .w-screen is the element with width:100vw that
    // needs to shrink. querySelector is fast and reliable here.
    return document.querySelector(".w-screen:not([id^='gbx'])") || null;
  }

  function setView(view) {
    currentView = view;
    const listBtn   = document.getElementById("gbx-view-list");
    const graphBtn  = document.getElementById("gbx-view-graph");
    const treeWrap  = document.querySelector(".gbx-tree-wrap");
    const graphWrap = document.getElementById("gbx-graph-wrap");
    const footer    = document.querySelector(".gbx-footer");

    if (view === "graph") {
      listBtn?.classList.remove("gbx-view-btn--active");
      graphBtn?.classList.add("gbx-view-btn--active");
      if (treeWrap)  treeWrap.style.display  = "none";
      if (footer)    footer.style.display    = "none";
      if (graphWrap) {
        graphWrap.classList.add("gbx-graph-visible");
        // Init graph if not already
        if (!graphWrap.dataset.initialized && window.GBXGraph) {
          window.GBXGraph.initGraph(graphWrap, {
            getData: () => ({
              ...scanTree(),
              variantLabelCache,
              activeMsgIndex,
            }),
            scrollToTurn,
            navTo: (fork, v) => navTo(fork, v),
            forkFromTurn: (turn, text, prefix) => forkFromTurn(turn, text, prefix),
          });
          graphWrap.dataset.initialized = "1";
        } else if (window.GBXGraph) {
          window.GBXGraph.update();
        }
      }
    } else {
      graphBtn?.classList.remove("gbx-view-btn--active");
      listBtn?.classList.add("gbx-view-btn--active");
      if (treeWrap)  treeWrap.style.display  = "";
      if (footer)    footer.style.display    = "";
      if (graphWrap) graphWrap.classList.remove("gbx-graph-visible");
      scanAndRender(true);
    }
  }

  function adjustChatLayout(open) {
    ensureLayoutStyle();
    const target = findLayoutTarget();
    if (!target) return;

    if (open) {
      target.classList.add(GBX_SHRINK_CLASS);
    } else {
      target.classList.remove(GBX_SHRINK_CLASS);
    }
  }

  function branchSVG(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/>
      <line x1="6" y1="8.5" x2="6" y2="15.5"/>
      <line x1="8.5" y1="6" x2="15.5" y2="6"/>
      <line x1="8.5" y1="6.5" x2="6.5" y2="15.5"/>
    </svg>`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORK BUTTONS ON USER MESSAGES
  // ════════════════════════════════════════════════════════════════════════════

  function injectForkButtons() {
    document.querySelectorAll(TURN_SEL).forEach((turn) => {
      const userMsg = turn.querySelector(USER_MSG_SEL);
      if (!userMsg) return;
      if (turn.querySelector(".gbx-fork-btn")) return; // already injected

      const btn = document.createElement("button");
      btn.className = "gbx-fork-btn";
      btn.title = "Fork branch here — edit this message to start a new conversation branch";
      btn.innerHTML = `${branchSVG(11)} Fork from here`;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        forkFromTurn(turn, null);
      });

      userMsg.appendChild(btn);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SELECTION MENU
  // ════════════════════════════════════════════════════════════════════════════

  function injectSelectionMenu() {
    if (document.getElementById(SEL_MENU_ID)) return;

    const menu = document.createElement("div");
    menu.id = SEL_MENU_ID;
    menu.innerHTML = `
      <button class="gbx-sm-btn gbx-sm-fork" id="gbx-sm-fork">
        ${branchSVG(12)} Fork branch here
      </button>
      <div class="gbx-sm-sep"></div>
      <button class="gbx-sm-btn gbx-sm-what" id="gbx-sm-what">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>
        </svg>
        What's a branch?
      </button>
      <div class="gbx-sm-explainer" id="gbx-sm-explainer">
        <strong>Branching</strong> lets you try a different direction from any point — without losing your current conversation. ChatGPT saves both threads; use <code>‹ ›</code> to switch.
        <button class="gbx-sm-got-it" id="gbx-sm-got-it">Got it</button>
      </div>
    `;
    document.body.appendChild(menu);

    // Fork button
    document.getElementById("gbx-sm-fork").addEventListener("mousedown", (e) => {
      e.preventDefault();
      hideSelMenu();
      const { text, node, isAssistant } = saved;
      if (!text) return;

      if (isAssistant) {
        // Find the assistant turn that was selected, then find the NEXT
        // user message turn after it — fork from there, not the bottom input.
        const assistantTurn = findTurn(node);
        const nextUserTurn  = findNextUserTurn(assistantTurn);
        if (nextUserTurn) {
          forkFromTurn(nextUserTurn, text, true); // explainPrefix=true
        } else {
          // No next user turn — selection is from the last assistant message.
          // Branching is not possible here. Show inline explanation.
          showCannotForkTooltip();
        }
      } else {
        const turn = findTurn(node);
        if (turn) forkFromTurn(turn, text);
        else prefillInput(`Explore: "${truncate(text, 200)}"`);
      }

      if (!sidebarOpen) toggleSidebar();
    });

    // What's a branch toggle
    document.getElementById("gbx-sm-what").addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById("gbx-sm-explainer").classList.toggle("gbx-sm-explainer--open");
    });

    document.getElementById("gbx-sm-got-it").addEventListener("mousedown", (e) => {
      e.preventDefault();
      document.getElementById("gbx-sm-explainer").classList.remove("gbx-sm-explainer--open");
    });
  }

  // Save selection state on mouseup (for use by native popup injector)
  // — our own popup is disabled, we inject into ChatGPT's native one instead
  document.addEventListener("mouseup", (e) => {
    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2) {
        saved = { text: "", node: null, isAssistant: false };
        return;
      }
      const anchor = sel.anchorNode;
      if (!isInConversation(anchor)) return;
      saved = { text, node: anchor, isAssistant: isInAssistant(anchor) };
    }, 30);
  });

  document.addEventListener("mousedown", (e) => {
    const menu = document.getElementById(SEL_MENU_ID);
    if (menu && !menu.contains(e.target)) hideSelMenu();
  });

  function placeSelMenu(cx, selTopPageY) {
    const menu = document.getElementById(SEL_MENU_ID);
    if (!menu) return;
    document.getElementById("gbx-sm-explainer")?.classList.remove("gbx-sm-explainer--open");

    // Use fixed positioning — avoids all scroll math
    menu.style.position = "fixed";
    menu.classList.add("gbx-sm--on");

    // cx and selTopPageY are page coords; convert cx to viewport x
    const vpX = cx - window.scrollX;
    // selTopPageY is page coord of selection top; convert to viewport y
    const vpY = selTopPageY - window.scrollY;

    const W = 210;
    let left = vpX - W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));

    // Place above the selection; flip below if too close to top
    const ABOVE_OFFSET = 10;
    const APPROX_H = 90; // approximate menu height before render
    let top = vpY - APPROX_H - ABOVE_OFFSET;
    if (top < 8) top = vpY + 28;

    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;

    // Recalc once rendered so height is accurate
    requestAnimationFrame(() => {
      let t = vpY - menu.offsetHeight - ABOVE_OFFSET;
      if (t < 8) t = vpY + 28;
      menu.style.top = `${t}px`;
    });
  }

  function hideSelMenu() {
    document.getElementById(SEL_MENU_ID)?.classList.remove("gbx-sm--on");
  }

  // Watch for ChatGPT's native text-selection popup and inject our button.
  // We detect it by position: after mouseup with a selection, any new element
  // that appears near the selection and contains buttons is the popup.
  function startNativePopupInjector() {
    const INJECTED_ATTR = "data-gbx-injected";
    const buildForkBtn = () => {
      const forkBtn = document.createElement("button");
      forkBtn.className = "gbx-native-fork-btn";
      forkBtn.innerHTML = `${branchSVG(12)} Fork branch here`;
      forkBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const { text, node, isAssistant } = saved;
        if (!text) return;
        if (isAssistant) {
          const assistantTurn = findTurn(node);
          const nextUserTurn  = findNextUserTurn(assistantTurn);
          if (nextUserTurn) forkFromTurn(nextUserTurn, text, true);
          else {
            // Show inline message in the popup
            forkBtn.textContent = "Can't branch from last message";
            forkBtn.style.color = "#999";
            setTimeout(() => {
              forkBtn.innerHTML = `${branchSVG(12)} Fork branch here`;
              forkBtn.style.color = "";
            }, 3000);
          }
        } else {
          const turn = findTurn(node);
          if (turn) forkFromTurn(turn, text);
        }
        if (!sidebarOpen) toggleSidebar();
      });
      return forkBtn;
    };

    const tryInject = (el) => {
      if (el.hasAttribute(INJECTED_ATTR)) return;
      if (el.id?.startsWith("gbx")) return;
      // Must contain at least one button and be a small floating element
      if (!el.querySelector("button")) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) return;
      // Must be positioned near the selection (within 300px vertically)
      if (selectionRect) {
        const vertDist = Math.abs(rect.top - selectionRect.top);
        if (vertDist > 300) return;
      }
      el.setAttribute(INJECTED_ATTR, "1");
      el.insertBefore(buildForkBtn(), el.firstChild);
    };

    // ChatGPT's popup has class "aria-live=polite fixed select-none"
    // and contains a div.shadow-long with the Ask button inside.
    // We inject into that inner div (the flex container holding the button).
    const CHATGPT_POPUP_SEL = '[class*="aria-live"][class*="fixed"]';

    const tryInjectIntoPopup = (node) => {
      if (node.hasAttribute?.(INJECTED_ATTR)) return;
      if (node.id?.startsWith("gbx")) return;

      // Match ChatGPT's popup wrapper
      const isPopup = node.matches?.(CHATGPT_POPUP_SEL) ||
                      node.querySelector?.(CHATGPT_POPUP_SEL);
      if (!isPopup) return;

      const popup = node.matches?.(CHATGPT_POPUP_SEL)
        ? node
        : node.querySelector(CHATGPT_POPUP_SEL);
      if (!popup || popup.hasAttribute(INJECTED_ATTR)) return;
      popup.setAttribute(INJECTED_ATTR, "1");

      // The inner flex container holds the Ask ChatGPT button
      // Restyle popup as a unified vertical card
      const currentTop  = parseInt(popup.style.top)  || 0;
      const currentLeft = popup.style.left;
      popup.style.cssText = `
        top: ${currentTop - 38}px;
        left: ${currentLeft};
        display: flex;
        flex-direction: column;
        background: white;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        position: fixed;
        z-index: 2147483646;
      `;

      // Remove inner shadow/radius so it blends into our unified card
      const inner = popup.querySelector(".shadow-long");
      if (inner) {
        inner.style.cssText = "box-shadow:none; border-radius:0;";
        const askBtn = inner.querySelector("button");
        if (askBtn) {
          askBtn.style.cssText = "border-radius:0; width:100%; justify-content:center;";
        }
      }

      // Prepend our fork button row above Ask ChatGPT
      const forkRow = document.createElement("div");
      forkRow.style.cssText = "display:flex; border-bottom:1px solid rgba(0,0,0,0.08);";
      forkRow.appendChild(buildForkBtn());
      popup.insertBefore(forkRow, popup.firstChild);
    };

    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.id?.startsWith("gbx")) continue;
          tryInjectIntoPopup(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CANNOT FORK TOOLTIP
  // ════════════════════════════════════════════════════════════════════════════

  function showCannotForkTooltip() {
    const menu = document.getElementById(SEL_MENU_ID);
    if (!menu) return;

    // Replace fork button with an explanation, then restore after 4s
    const forkBtn = document.getElementById("gbx-sm-fork");
    if (!forkBtn) return;

    const orig = forkBtn.innerHTML;
    forkBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      Can't branch from the last message
    `;
    forkBtn.style.color = "var(--gbx-text3)";
    forkBtn.style.cursor = "default";
    forkBtn.style.fontSize = "11.5px";

    // Show explainer
    const exp = document.getElementById("gbx-sm-explainer");
    if (exp) {
      exp.style.display = "block";
      const origHtml = exp.innerHTML;
      exp.innerHTML = `<strong>Why can't I branch here?</strong>
        ChatGPT can only create branches by editing a past user message.
        Since this is the last message, there's no user message after it to edit.
        Try selecting text from an <em>earlier</em> assistant message instead,
        or use <strong>Ask ChatGPT</strong> to send a follow-up.
        <button class="gbx-sm-got-it" id="gbx-sm-got-it-2">Got it</button>`;
      document.getElementById("gbx-sm-got-it-2")?.addEventListener("mousedown", (e) => {
        e.preventDefault();
        hideSelMenu();
      });
      setTimeout(() => {
        exp.style.display = "none";
        exp.innerHTML = origHtml;
        forkBtn.innerHTML = orig;
        forkBtn.style.color = "";
        forkBtn.style.cursor = "";
        forkBtn.style.fontSize = "";
      }, 6000);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORK LOGIC
  // ════════════════════════════════════════════════════════════════════════════

  async function forkFromTurn(turn, selText, explainPrefix = false) {
    // selText: the raw selected text (no wrapping)
    // explainPrefix: if true, wrap as Explain: "..."  (for assistant selections)
    const finalText = selText
      ? (explainPrefix ? `Explain: "${truncate(selText, 200)}"` : truncate(selText, 200))
      : "";

    simulateHover(turn);
    await sleep(250);
    const editBtn = turn.querySelector(EDIT_BTN_SEL);
    if (editBtn) {
      editBtn.click();
      await sleep(400);
      const ta = turn.querySelector("textarea") || document.querySelector("textarea[data-id]");
      if (ta) setReactVal(ta, finalText || (ta.value || ""));
    } else {
      if (finalText) prefillInput(finalText);
    }
    if (!sidebarOpen) toggleSidebar();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOAD ALL BRANCH NAMES
  // ════════════════════════════════════════════════════════════════════════════

  async function loadAllBranchNames() {
    const btn = document.getElementById("gbx-load-all");
    if (!btn || btn.dataset.loading === "1") return;

    btn.dataset.loading = "1";
    const origHTML = btn.innerHTML;
    let visited = 0;
    const setStatus = (msg) => { btn.textContent = msg; };
    setStatus("Loading…");

    // Read the user message label FOR the current variant at a fork.
    // The fork turn is a user message turn (the edited one) — its text
    // is what differs between variants. Read it directly from that turn.
    // Fall back to the turn above if the fork turn itself has no user msg.
    const readVariantLabel = (forkTurnIdx) => {
      const allTurns = Array.from(document.querySelectorAll(TURN_SEL));
      // First try: the fork turn itself (it's the edited user message)
      const forkTurn = allTurns[forkTurnIdx];
      if (forkTurn) {
        const u = forkTurn.querySelector(USER_MSG_SEL);
        if (u) {
          const clone = u.cloneNode(true);
          clone.querySelectorAll(".gbx-fork-btn").forEach(el => el.remove());
          const text = clone.innerText?.trim().slice(0, 80);
          if (text) return text;
        }
      }
      // Fallback: walk backwards to find nearest user message
      for (let i = forkTurnIdx - 1; i >= 0; i--) {
        const u = allTurns[i]?.querySelector(USER_MSG_SEL);
        if (u) {
          const clone = u.cloneNode(true);
          clone.querySelectorAll(".gbx-fork-btn").forEach(el => el.remove());
          return clone.innerText?.trim().slice(0, 80) || null;
        }
      }
      return null;
    };

    // DFS: visit every variant of every fork reachable from current DOM state.
    // visitedForks = Set of "parentTurnIndex:variant" strings already processed,
    // preventing infinite recursion when the same fork appears across variants.
    const dfs = async (visitedForks) => {
      const { forkMap } = scanTree();

      for (const [parentTurnIndex, fork] of forkMap.entries()) {
        const savedVariant = fork.current;

        for (let v = 1; v <= fork.total; v++) {
          const key = `${parentTurnIndex}:${v}`;
          if (visitedForks.has(key)) continue;   // already processed — skip
          visitedForks.add(key);

          const cached    = variantLabelCache[parentTurnIndex]?.[v];
          const needsLabel = !cached || cached.startsWith("Variant ");

          if (v !== fork.current) {
            await navTo({ turnIndex: fork.turnIndex }, v);
            await sleep(300);
            visited++;
            setStatus(`Loading… (${visited} visited)`);
          }

          if (needsLabel) {
            // Re-scan after navigation to get the live fork turn index —
            // the stale fork.turnIndex from before navTo is wrong after
            // React re-renders the DOM.
            const { forkMap: liveForkMap } = scanTree();
            const liveFork = liveForkMap.get(parentTurnIndex);
            const liveTurnIdx = liveFork ? liveFork.turnIndex : fork.turnIndex;
            const label = readVariantLabel(liveTurnIdx);
            if (label) {
              if (!variantLabelCache[parentTurnIndex]) variantLabelCache[parentTurnIndex] = {};
              variantLabelCache[parentTurnIndex][v] = label;
            }
          }

          // Recurse — this variant may expose new deeper forks
          await dfs(visitedForks);

          if (sidebarOpen) renderTree(scanTree());
        }

        // Backtrack to original variant — re-scan to get live turnIndex
        const { forkMap: backForkMap } = scanTree();
        const backFork = backForkMap.get(parentTurnIndex);
        const backTurnIdx = backFork ? backFork.turnIndex : fork.turnIndex;
        if (backFork && backFork.current !== savedVariant) {
          await navTo({ turnIndex: backTurnIdx }, savedVariant);
          await sleep(200);
        }
      }
    };

    try {
      await dfs(new Set());
      setStatus("✓ Done");
      await sleep(1200);
    } catch (err) {
      console.error("loadAllBranchNames error:", err);
      setStatus("Error — try again");
      await sleep(2000);
    }

    btn.innerHTML = origHTML;
    delete btn.dataset.loading;
    scanAndRender(true);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH TREE — scan + render
  // ════════════════════════════════════════════════════════════════════════════

  // variantLabelCache[turnIndex][variantNum] = label string
  // Persists across re-renders so labels accumulate as user visits variants.
  const variantLabelCache = {};

  // expandedForks: set of turnIndexes whose branch list is expanded in sidebar
  const expandedForks = new Set();
  let   activeMsgIndex  = -1;  // turnIndex of currently highlighted user message
  let   scrollLocked    = false; // true after sidebar click, until user manually scrolls

  /**
   * scanTree — returns two things:
   *   allUserMsgs : every user message turn { turnIndex, label }
   *   forkMap     : Map<turnIndex, { current, total, prevBtn, nextBtn, label }>
   *
   * For each fork point (< > arrows present), the "parent" is the PREVIOUS
   * user message turn — i.e. the question that caused the branched response.
   */
  function scanTree() {
    const turns      = Array.from(document.querySelectorAll(TURN_SEL));
    const allUserMsgs = [];
    const forkMap    = new Map();

    turns.forEach((turn, idx) => {
      // Collect every user message
      const userEl = turn.querySelector(USER_MSG_SEL);
      if (userEl) {
        // Read only the text content of the user message, excluding any
        // injected buttons (e.g. our .gbx-fork-btn) by cloning and stripping them
        const clone = userEl.cloneNode(true);
        clone.querySelectorAll(".gbx-fork-btn").forEach(el => el.remove());
        const text = clone.innerText?.trim() || "";
        allUserMsgs.push({
          turnIndex: idx,
          label: text.slice(0, 80) || `Message ${idx + 1}`,
          turn,
        });
      }

      // Detect fork points (< > arrows)
      const prev = turn.querySelector("button[aria-label='Previous response']");
      const next = turn.querySelector("button[aria-label='Next response']");
      if (!prev || !next) return;

      const m = (prev.parentElement?.textContent || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return;

      const current = parseInt(m[1], 10);
      const total   = parseInt(m[2], 10);

      // The "parent" user message is the closest user turn BEFORE this turn
      const msgEl = turn.querySelector(USER_MSG_SEL) || turn.querySelector(ASST_MSG_SEL);
      let label = `Message ${idx + 1}`;
      if (msgEl) {
        const clone2 = msgEl.cloneNode(true);
        clone2.querySelectorAll(".gbx-fork-btn").forEach(el => el.remove());
        label = clone2.innerText?.trim().slice(0, 80) || label;
      }

      // Find the index of the previous user message turn
      let parentTurnIndex = idx;
      for (let i = allUserMsgs.length - 1; i >= 0; i--) {
        if (allUserMsgs[i].turnIndex < idx) {
          parentTurnIndex = allUserMsgs[i].turnIndex;
          break;
        }
      }

      // Update cache with current variant label
      if (!variantLabelCache[parentTurnIndex]) variantLabelCache[parentTurnIndex] = {};
      variantLabelCache[parentTurnIndex][current] = label;

      // If multiple fork turns share the same parent, keep the one with most variants
      const existing = forkMap.get(parentTurnIndex);
      if (!existing || total > existing.total) {
        forkMap.set(parentTurnIndex, {
          turnIndex:        idx,         // the actual turn with arrows
          parentTurnIndex,               // the user message above it
          current, total, prev, next, label,
        });
      }
    });

    return { allUserMsgs, forkMap };
  }

  function renderTree({ allUserMsgs, forkMap }) {
    const tree  = document.getElementById("gbx-tree");
    const empty = document.getElementById("gbx-empty");
    if (!tree || !empty) return;
    tree.innerHTML = "";

    if (!allUserMsgs.length) {
      empty.style.display = "flex";
      tree.style.display  = "none";
      return;
    }
    empty.style.display = "none";
    tree.style.display  = "block";

    allUserMsgs.forEach((msg) => {
      const fork       = forkMap.get(msg.turnIndex);
      const hasFork    = !!fork;
      const isExpanded = expandedForks.has(msg.turnIndex);

      // Capture these by value so closures don't go stale
      const msgTurnIndex  = msg.turnIndex;
      const forkTurnIndex = fork ? fork.turnIndex : -1;
      const forkTotal     = fork ? fork.total : 0;
      const forkCurrent   = fork ? fork.current : 0;
      const cache         = hasFork ? (variantLabelCache[msgTurnIndex] || {}) : {};

      const li = document.createElement("li");
      const isActive = msgTurnIndex === activeMsgIndex;
      li.className = "gbx-msg-item" + (hasFork ? " gbx-msg-has-fork" : "") + (isActive ? " gbx-msg-active" : "");

      const row = document.createElement("div");
      row.className = "gbx-msg-row";
      row.title     = msg.label;
      row.innerHTML = `
        <span class="gbx-msg-dot"></span>
        <span class="gbx-msg-text">${esc(trunc(msg.label, 44))}</span>
        ${hasFork ? `<span class="gbx-fork-badge">${forkTotal} <span class="gbx-fork-badge-sym">⑂</span></span>` : ""}
        ${hasFork ? `<span class="gbx-expand-arrow">${isExpanded ? "▾" : "▸"}</span>` : ""}
      `;

      row.addEventListener("click", () => {
        activeMsgIndex = msgTurnIndex;
        scrollLocked   = true;             // disable scroll sync until user scrolls manually
        scrollToTurn(msgTurnIndex);
        const alreadyOpen = expandedForks.has(msgTurnIndex);
        expandedForks.clear();
        if (hasFork && !alreadyOpen) expandedForks.add(msgTurnIndex);
        scanAndRender(true);
      });

      li.appendChild(row);

      if (hasFork && isExpanded) {
        const vl = document.createElement("ul");
        vl.className = "gbx-variants";

        for (let v = 1; v <= forkTotal; v++) {
          const on    = v === forkCurrent;
          const label = cache[v] || (on ? (fork.label || `Variant ${v}`) : `Variant ${v}`);

          const vli        = document.createElement("li");
          vli.className    = "gbx-var";          // no highlight class on active
          vli.style.cursor = "pointer";
          vli.title        = on ? "Currently active — click to scroll" : `Switch to: ${label}`;
          vli.innerHTML    = `
            <span class="gbx-var-dot${on ? " gbx-var-dot--on" : ""}"></span>
            <span class="gbx-var-name" title="${esc(label)}">${esc(trunc(label, 38))}</span>
          `;

          // Capture v by value in IIFE
          vli.addEventListener("click", ((capturedV, capturedOn, capturedForkIdx) => (e) => {
            e.stopPropagation();
            if (capturedOn) {
              // Scroll to the branched assistant turn (where < > arrows are)
              scrollToTurn(capturedForkIdx);
            } else {
              const liveFork = { turnIndex: capturedForkIdx };
              navTo(liveFork, capturedV).then(() => scrollToTurn(capturedForkIdx));
            }
          })(v, on, forkTurnIndex));

          vl.appendChild(vli);
        }
        li.appendChild(vl);
      }

      tree.appendChild(li);
    });
  }

  function scrollToTurn(turnIndex) {
    const turn = document.querySelectorAll(TURN_SEL)[turnIndex];
    if (!turn) return;
    turn.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = turn.style.outline;
    turn.style.outline      = "2px solid rgba(91,156,246,0.55)";
    turn.style.borderRadius = "8px";
    setTimeout(() => { turn.style.outline = prev; turn.style.borderRadius = ""; }, 1200);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      injectForkButtons();
      scanAndRender();
    }, 300);
  }

  function treeFingerprint({ allUserMsgs, forkMap }) {
    const msgs  = allUserMsgs.map(m => m.turnIndex).join(",");
    const forks = [...forkMap.entries()].map(([k,v]) => `${k}:${v.current}/${v.total}`).join("|");
    return msgs + "§" + forks;
  }

  let lastFingerprint = "";

  function scanAndRender(force = false) {
    const data = scanTree();
    const fp   = treeFingerprint(data);
    if (!force && fp === lastFingerprint) return;
    lastFingerprint = fp;
    if (!sidebarOpen) return;
    if (currentView === "graph" && window.GBXGraph) {
      window.GBXGraph.update();
    } else {
      renderTree(data);
    }
  }


  // ════════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ════════════════════════════════════════════════════════════════════════════

  async function navTo(fork, targetVariant) {
    // fork.turnIndex is the turn with the < > arrows (not the parent user turn).
    // After each click React re-renders — re-query buttons fresh every loop.
    const getLiveButtons = () => {
      const turns = document.querySelectorAll(TURN_SEL);
      const turn  = turns[fork.turnIndex];
      if (!turn) return null;
      const prev = turn.querySelector("button[aria-label='Previous response']");
      const next = turn.querySelector("button[aria-label='Next response']");
      if (!prev || !next) return null;
      const m = (prev.parentElement?.textContent || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) return null;
      return { prev, next, current: parseInt(m[1], 10) };
    };

    let attempts = 0;
    while (attempts < 20) {
      const btns = getLiveButtons();
      if (!btns) break;
      if (btns.current === targetVariant) break;
      (btns.current < targetVariant ? btns.next : btns.prev).click();
      await sleep(300);
      attempts++;
    }
    await sleep(200);
    scanAndRender(true);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  function findTurn(node) {
    let el = node?.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (el.matches?.(TURN_SEL)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findNextUserTurn(turn) {
    if (!turn) return null;
    // Walk forward through sibling turns until we find one with a user message
    const allTurns = Array.from(document.querySelectorAll(TURN_SEL));
    const idx = allTurns.indexOf(turn);
    if (idx === -1) return null;
    for (let i = idx + 1; i < allTurns.length; i++) {
      if (allTurns[i].querySelector(USER_MSG_SEL)) return allTurns[i];
    }
    return null; // no next user turn (assistant message is last)
  }

  function isInConversation(node) {
    // Only block selection inside our own injected UI elements
    let el = node?.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      const id = el.id || '';
      if (id === SIDEBAR_ID || id === SEL_MENU_ID || id === TOGGLE_ID) return false;
      el = el.parentElement;
    }
    return true; // allow everywhere else on the page
  }

  function isInAssistant(node) {
    let el = node?.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (el.matches?.(ASST_MSG_SEL)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function simulateHover(el) {
    ["mouseover", "mouseenter"].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true }))
    );
  }

  function prefillInput(text) {
    const el = document.querySelector("#prompt-textarea")
            || document.querySelector("[contenteditable='true'][data-id]")
            || document.querySelector("textarea[placeholder]");
    if (!el) return;
    setReactVal(el, text);
    el.focus();
  }

  function setReactVal(el, val) {
    try {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const proto  = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(el, val);
      } else if (el.isContentEditable) {
        el.innerText = val;
      }
    } catch (_) {
      el.isContentEditable ? (el.innerText = val) : (el.value = val);
    }
    ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  }

  function sleep(ms)  { return new Promise((r) => setTimeout(r, ms)); }
  function trunc(s,n) { return s.length > n ? s.slice(0,n)+"…" : s; }
  function truncate(s,n) { return trunc(s,n); }
  function esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCROLL SYNC — highlight sidebar item as user scrolls the chat
  // ════════════════════════════════════════════════════════════════════════════

  function startScrollSync() {
    // Use IntersectionObserver to watch all user message turns.
    // Whichever user message is most visible near the top of the viewport
    // becomes the active sidebar highlight.
    const observer = new IntersectionObserver((entries) => {
      let best = null, bestRatio = 0;
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
          bestRatio = entry.intersectionRatio;
          best = entry.target;
        }
      });
      if (!best) return;

      // Find which user message turn this corresponds to
      const turns = Array.from(document.querySelectorAll(TURN_SEL));
      const idx   = turns.indexOf(best);
      if (idx === -1 || idx === activeMsgIndex) return;

      // Only update if this turn has a user message
      if (!best.querySelector(USER_MSG_SEL)) return;

      if (scrollLocked) return;   // locked after sidebar click — ignore until user scrolls
      activeMsgIndex = idx;
      if (!sidebarOpen) return;
      if (currentView === "graph" && window.GBXGraph) {
        window.GBXGraph.setActiveNode(idx);
      } else {
        renderTree(scanTree());
      }
    }, {
      root:       null,           // viewport
      rootMargin: "0px 0px -40% 0px", // trigger when in top 60% of viewport
      threshold:  [0.1, 0.5, 1.0],
    });

    // Observe all current user turns, and new ones as they appear
    const observeUserTurns = () => {
      document.querySelectorAll(TURN_SEL).forEach(turn => {
        if (turn.querySelector(USER_MSG_SEL)) observer.observe(turn);
      });
    };

    observeUserTurns();

    // Re-observe whenever new turns are added
    new MutationObserver(() => observeUserTurns())
      .observe(document.body, { childList: true, subtree: true });

    // Unlock scroll sync the moment the user manually scrolls
    // (wheel, touch, or keyboard). Using capture so we catch it regardless
    // of which element has focus.
    const unlock = () => { scrollLocked = false; };
    window.addEventListener("wheel",     unlock, { passive: true, capture: true });
    window.addEventListener("touchmove", unlock, { passive: true, capture: true });
    window.addEventListener("keydown",   (e) => {
      const scrollKeys = ["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "];
      if (scrollKeys.includes(e.key)) unlock();
    }, { capture: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TOOLBAR ICON CLICK — message from background.js
  // ════════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "GBX_TOGGLE_SIDEBAR") toggleSidebar();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // OBSERVERS + URL WATCHER + BOOT
  // ════════════════════════════════════════════════════════════════════════════

  function startObserver() {
    // Watch body direct children — re-inject our UI if React wipes it
    new MutationObserver((muts) => {
      let needsScan = false, needsReinject = false;
      for (const m of muts) {
        if (m.addedNodes.length || m.removedNodes.length) needsScan = true;
        for (const node of m.removedNodes) {
          if (node.nodeType === 1) {
            const id = node.id || "";
            if (id === TOGGLE_ID || id === SIDEBAR_ID || id === SEL_MENU_ID) needsReinject = true;
          }
        }
      }
      if (needsReinject) {
        injectSidebar();
        injectSelectionMenu();
        if (sidebarOpen) {
          const sb = document.getElementById(SIDEBAR_ID);
          if (sb) { sb.style.transform = "translateX(0)"; sb.style.visibility = "visible"; }
        }
      }
      if (needsScan) scheduleScan();
    }).observe(document.body, { childList: true, subtree: false });

    // Poll the branch fingerprint every 500ms while sidebar is open.
    // This reliably catches native < > arrow clicks which only swap text
    // nodes — much cheaper than characterData on the whole main tree.
    setInterval(() => {
      if (sidebarOpen) scanAndRender();
    }, 500);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl     = location.href;
      lastFingerprint = "";
      setTimeout(() => { injectForkButtons(); if (sidebarOpen) scanAndRender(true); }, 900);
    }
  }).observe(document, { subtree: true, childList: true });

  function init() {
    injectSidebar();
    injectSelectionMenu();
    startObserver();
    startScrollSync();
    startNativePopupInjector();
    setTimeout(injectForkButtons, 1500);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();

})();
