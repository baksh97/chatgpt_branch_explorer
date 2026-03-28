/**
 * graph.js — Branch Explorer Graph View
 *
 * Rules:
 *  - Tree is ALWAYS fully expanded. Structure never changes on click.
 *  - Clicking a node only updates the active-path highlight.
 *  - Active path = the chain of nodes leading to the currently active message.
 */
window.GBXGraph = (() => {
  "use strict";

  const NODE_R = 18;
  const H_GAP = 90;   // vertical gap between levels
  const V_GAP = 60;   // horizontal gap between sibling subtrees
  const PAD = 40;

  const C = {
    bg: "#141414",
    node: "#1c1c1c",
    nodeBorder: "#444",
    nodeActiveFill: "#1a1a2e",
    nodeActiveBorder: "#3d7eff",
    edgeActive: "#3d7eff",
    edgeInactive: "#2e2e2e",
    text: "#e8e8e8",
    textDim: "#666",
    glow: "rgba(61,126,255,0.12)",
    orange: "#f5a623",
    addBg: "#242424",
    addColor: "#5b9cf6",
  };

  let container = null;
  let api = null;
  let svg = null;
  let treeRoot = null;   // stable tree — never rebuilt on click
  let activeIds = new Set();
  let suppressNextUpdate = false; // true after variant click to block rebuild

  // ── Public ──────────────────────────────────────────────────────────────────

  function initGraph(el, apiObj) {
    container = el;
    api = apiObj;
    container.style.cssText = `
      width:100%; height:100%; overflow:auto;
      background:${C.bg}; position:relative; box-sizing:border-box;
    `;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.cssText = "display:block; overflow:visible; transform-origin:top left;";
    container.appendChild(svg);

    // Zoom via wheel
    let scale = 1;
    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.99 : 1.01;
      scale = Math.min(3, Math.max(0.2, scale * delta));
      svg.style.transform = `scale(${scale})`;
    }, { passive: false });

    fullUpdate();
  }

  // Called when new messages arrive — rebuilds structure + re-renders
  function update() {
    if (!container || !api) return;
    fullUpdate();
  }

  // Called on scroll sync — only updates highlight, never rebuilds
  function setActiveNode(turnIndex) {
    if (!treeRoot) return;
    const data = api.getData();
    recomputeActive({ ...data, activeMsgIndex: turnIndex });
    repaintHighlight();
  }

  // ── Full rebuild (structure + layout + render) ────────────────────────────

  function fullUpdate() {
    const data = api.getData();
    treeRoot = buildTree(data);
    recomputeActive(data);
    if (treeRoot) {
      computeSubtreeWidth(treeRoot);
      assignPositions(treeRoot, PAD, 0);
      // Print tree to console for debugging
      console.log("[GBXGraph] Tree structure:");
      printTree(treeRoot, "", true);
    }
    render();
  }

  function printTree(node, prefix, isLast) {
    const connector = isLast ? "└── " : "├── ";
    const tag = node.isVariant ? `[v${node.variantNum}${node.isActiveVariant ? "*" : ""}]` : "[msg]";
    console.log(prefix + connector + tag + " " + node.label + (node.children.length ? ` (${node.children.length} children)` : ""));
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    node.children.forEach((child, i) => {
      printTree(child, childPrefix, i === node.children.length - 1);
    });
  }

  // ── Build tree — ALL variants get ALL downstream messages as children ──────
  //
  // Structure:
  //   root (first user msg)
  //     └─ next user msg
  //          └─ ...
  //               └─ fork parent msg
  //                    ├─ variant 1
  //                    │    └─ msgs after fork (full chain)
  //                    ├─ variant 2
  //                    │    └─ msgs after fork (full chain)
  //                    └─ variant N
  //                         └─ msgs after fork (full chain)
  //
  // Every variant gets an identical copy of the downstream chain so the
  // tree is always fully visible regardless of which variant is active.

  function buildTree(data) {
    const { allUserMsgs, forkMap, variantLabelCache } = data;
    if (!allUserMsgs.length) return null;

    // Build main chain as node objects
    const mainNodes = allUserMsgs.map(msg => ({
      id: `m${msg.turnIndex}`,
      label: msg.label,
      turnIndex: msg.turnIndex,
      forkTurnIdx: null,
      isVariant: false,
      variantNum: null,
      isActiveVariant: false,
      fork: forkMap.get(msg.turnIndex) || null,
      parentTurnIndex: null,
      children: [],
      x: 0, y: 0, subtreeW: 0,
    }));

    // Helper: deep-clone a chain of nodes starting from index `startIdx`
    // in mainNodes, giving each a unique id suffix `suffix`
    function cloneChain(startIdx, suffix) {
      if (startIdx >= mainNodes.length) return [];
      const nodes = mainNodes.slice(startIdx).map((n, i) => ({
        ...n,
        id: `${n.id}_${suffix}_${i}`,
        children: [],
        subtreeW: 0,
      }));
      // Re-attach fork children recursively on clones
      for (let i = 0; i < nodes.length - 1; i++) {
        nodes[i].children = [nodes[i + 1]];
      }
      // Expand fork points in clones
      for (let i = 0; i < nodes.length; i++) {
        const orig = mainNodes[startIdx + i];
        const fork = forkMap.get(orig.turnIndex);
        if (!fork) continue;
        const cache = variantLabelCache[orig.turnIndex] || {};
        const nextIdx = startIdx + i + 1;
        nodes[i].children = [];
        for (let v = 1; v <= fork.total; v++) {
          const label = cache[v] || `Variant ${v}`;
          const vNode = {
            id: `v${orig.turnIndex}-${v}_${suffix}_${i}`,
            label,
            turnIndex: orig.turnIndex,
            forkTurnIdx: fork.turnIndex,
            isVariant: true,
            variantNum: v,
            isActiveVariant: v === fork.current,
            fork,
            parentTurnIndex: orig.turnIndex,
            children: cloneChain(nextIdx, `${suffix}_${v}`),
            x: 0, y: 0, subtreeW: 0,
          };
          nodes[i].children.push(vNode);
        }
      }
      return nodes;
    }

    // Build the top-level chain and expand forks
    for (let i = 0; i < mainNodes.length - 1; i++) {
      mainNodes[i].children = [mainNodes[i + 1]];
    }
    for (let i = 0; i < mainNodes.length; i++) {
      const fork = forkMap.get(mainNodes[i].turnIndex);
      if (!fork) continue;
      const cache = variantLabelCache[mainNodes[i].turnIndex] || {};
      const nextIdx = i + 1;
      mainNodes[i].children = [];
      for (let v = 1; v <= fork.total; v++) {
        const label = cache[v] || `Variant ${v}`;
        const vNode = {
          id: `v${mainNodes[i].turnIndex}-${v}`,
          label,
          turnIndex: mainNodes[i].turnIndex,
          forkTurnIdx: fork.turnIndex,
          isVariant: true,
          variantNum: v,
          isActiveVariant: v === fork.current,
          fork,
          parentTurnIndex: mainNodes[i].turnIndex,
          children: cloneChain(nextIdx, `root_${v}`),
          x: 0, y: 0, subtreeW: 0,
        };
        mainNodes[i].children.push(vNode);
      }
    }

    return mainNodes[0];
  }

  // ── Active path computation ───────────────────────────────────────────────
  // Walk the tree. A node is "active" if:
  //   - It's a main node matching activeMsgIndex
  //   - It's an active variant (isActiveVariant)
  //   - It's an ancestor of any active node

  function recomputeActive(data) {
    activeIds = new Set();
    if (!treeRoot) return;
    const targetTurn = data.activeMsgIndex ?? -1;

    function dfs(node) {
      const selfMatch = (!node.isVariant && node.turnIndex === targetTurn)
        || (node.isVariant && node.isActiveVariant);
      let childMatch = false;
      for (const c of node.children) {
        if (dfs(c)) childMatch = true;
      }
      if (selfMatch || childMatch) {
        activeIds.add(node.id);
        return true;
      }
      return false;
    }
    dfs(treeRoot);
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  function computeSubtreeWidth(node) {
    if (!node.children.length) {
      node.subtreeW = NODE_R * 2;
      return node.subtreeW;
    }
    let total = 0;
    node.children.forEach((c, i) => {
      total += computeSubtreeWidth(c);
      if (i < node.children.length - 1) total += V_GAP;
    });
    node.subtreeW = Math.max(NODE_R * 2, total);
    return node.subtreeW;
  }

  function assignPositions(node, left, depth) {
    node.x = left + node.subtreeW / 2;
    node.y = PAD + depth * (NODE_R * 2 + H_GAP);
    let cx = left;
    node.children.forEach(c => {
      assignPositions(c, cx, depth + 1);
      cx += c.subtreeW + V_GAP;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    if (!svg) return;
    svg.innerHTML = "";

    if (!treeRoot) {
      const t = ns("text");
      t.setAttribute("x", "50%"); t.setAttribute("y", "50%");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", C.textDim);
      t.setAttribute("font-size", "13");
      t.setAttribute("font-family", "system-ui,sans-serif");
      t.textContent = "Start a conversation to see the graph";
      svg.appendChild(t);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      return;
    }

    let maxX = 0, maxY = 0;
    walk(treeRoot, n => {
      maxX = Math.max(maxX, n.x + NODE_R + 10);
      maxY = Math.max(maxY, n.y + NODE_R + 50);
    });
    svg.setAttribute("width", maxX + PAD);
    svg.setAttribute("height", maxY + PAD);

    const g = ns("g");
    svg.appendChild(g);

    // Edges first
    walk(treeRoot, node => {
      node.children.forEach(child => {
        const active = activeIds.has(node.id) && activeIds.has(child.id);
        const line = ns("line");
        line.setAttribute("x1", node.x);
        line.setAttribute("y1", node.y + NODE_R);
        line.setAttribute("x2", child.x);
        line.setAttribute("y2", child.y - NODE_R);
        line.setAttribute("stroke", active ? C.edgeActive : C.edgeInactive);
        line.setAttribute("stroke-width", active ? "2.5" : "1.5");
        line.setAttribute("stroke-linecap", "round");
        if (!active) line.setAttribute("stroke-dasharray", "4,4");
        g.appendChild(line);
      });
    });

    // Nodes on top
    walk(treeRoot, node => drawNode(g, node));

    drawLegend();
  }

  // Only repaint highlight colors without rebuilding SVG
  function repaintHighlight() {
    if (!svg) return;
    // Repaint edges
    svg.querySelectorAll("line[data-from]").forEach(line => {
      const fromId = line.dataset.from;
      const toId = line.dataset.to;
      const active = activeIds.has(fromId) && activeIds.has(toId);
      line.setAttribute("stroke", active ? C.edgeActive : C.edgeInactive);
      line.setAttribute("stroke-width", active ? "2.5" : "1.5");
      line.setAttribute("stroke-dasharray", active ? "none" : "4,4");
    });
    // Repaint node circles
    svg.querySelectorAll(".gbx-gnode").forEach(g => {
      const id = g.dataset.nodeid;
      const active = activeIds.has(id);
      const circle = g.querySelector("circle.main-circle");
      if (circle) {
        circle.setAttribute("fill", active ? C.nodeActiveFill : C.node);
        circle.setAttribute("stroke", active ? C.nodeActiveBorder : C.nodeBorder);
      }
      const glow = g.querySelector("circle.glow-circle");
      if (glow) glow.style.display = active ? "" : "none";
      // Text color
      const lbl = g.querySelector("text.node-label");
      if (lbl) lbl.setAttribute("fill", active ? C.text : C.textDim);
    });
  }

  function drawNode(g, node) {
    const active = activeIds.has(node.id);

    const group = ns("g");
    group.classList.add("gbx-gnode");
    group.dataset.nodeid = node.id;
    group.style.cursor = "pointer";

    // Glow
    const glow = ns("circle");
    glow.classList.add("glow-circle");
    glow.setAttribute("cx", node.x);
    glow.setAttribute("cy", node.y);
    glow.setAttribute("r", NODE_R + 6);
    glow.setAttribute("fill", C.glow);
    if (!active) glow.style.display = "none";
    group.appendChild(glow);

    // Main circle
    const circle = ns("circle");
    circle.classList.add("main-circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", NODE_R);
    circle.setAttribute("fill", active ? C.nodeActiveFill : C.node);
    circle.setAttribute("stroke", active ? C.nodeActiveBorder : C.nodeBorder);
    circle.setAttribute("stroke-width", active ? "2" : "1.5");
    group.appendChild(circle);

    // Person icon
    const iconColor = active ? "#5b9cf6" : "#555";
    const head = ns("circle");
    head.setAttribute("cx", node.x);
    head.setAttribute("cy", node.y - 5);
    head.setAttribute("r", 5.5);
    head.setAttribute("fill", iconColor);
    group.appendChild(head);

    const body = ns("path");
    body.setAttribute("d", `M${node.x - 9},${node.y + 15} Q${node.x},${node.y + 4} ${node.x + 9},${node.y + 15}`);
    body.setAttribute("stroke", iconColor);
    body.setAttribute("stroke-width", "2.5");
    body.setAttribute("fill", "none");
    body.setAttribute("stroke-linecap", "round");
    group.appendChild(body);

    // Variant badge top-right
    if (node.isVariant) {
      const bc = ns("circle");
      bc.setAttribute("cx", node.x + NODE_R - 1);
      bc.setAttribute("cy", node.y - NODE_R + 1);
      bc.setAttribute("r", 8);
      bc.setAttribute("fill", node.isActiveVariant ? "#3d7eff" : "#2a2a2a");
      bc.setAttribute("stroke", "#141414");
      bc.setAttribute("stroke-width", "1.5");
      group.appendChild(bc);
      const bt = ns("text");
      bt.setAttribute("x", node.x + NODE_R - 1);
      bt.setAttribute("y", node.y - NODE_R + 5);
      bt.setAttribute("text-anchor", "middle");
      bt.setAttribute("font-size", "8");
      bt.setAttribute("font-family", "monospace");
      bt.setAttribute("fill", "white");
      bt.textContent = `v${node.variantNum}`;
      group.appendChild(bt);
    }

    // Fork dot bottom-right
    if (!node.isVariant && node.fork) {
      const fd = ns("circle");
      fd.setAttribute("cx", node.x + NODE_R - 3);
      fd.setAttribute("cy", node.y + NODE_R - 3);
      fd.setAttribute("r", 5);
      fd.setAttribute("fill", C.orange);
      fd.setAttribute("stroke", "#141414");
      fd.setAttribute("stroke-width", "1.5");
      group.appendChild(fd);
    }

    // Label below
    const clipId = `clip-${node.id.replace(/[^a-z0-9]/gi, "-")}`;
    const cp = ns("clipPath"); cp.setAttribute("id", clipId);
    const cr = ns("rect");
    cr.setAttribute("x", node.x - 55);
    cr.setAttribute("y", node.y + NODE_R);
    cr.setAttribute("width", 110);
    cr.setAttribute("height", 28);
    cp.appendChild(cr);
    group.appendChild(cp);

    const lbl = ns("text");
    lbl.classList.add("node-label");
    lbl.setAttribute("x", node.x);
    lbl.setAttribute("y", node.y + NODE_R + 13);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("font-size", "10");
    lbl.setAttribute("font-family", "system-ui,sans-serif");
    lbl.setAttribute("fill", active ? C.text : C.textDim);
    lbl.setAttribute("font-weight", active ? "500" : "400");
    lbl.setAttribute("clip-path", `url(#${clipId})`);
    lbl.textContent = node.label;
    group.appendChild(lbl);

    // + button (add child / fork)
    const addG = ns("g");
    addG.style.opacity = "0";
    addG.style.transition = "opacity 0.15s";
    addG.style.cursor = "pointer";
    const addBg = ns("circle");
    addBg.setAttribute("cx", node.x);
    addBg.setAttribute("cy", node.y + NODE_R + 34);
    addBg.setAttribute("r", 9);
    addBg.setAttribute("fill", C.addBg);
    addBg.setAttribute("stroke", "#444");
    addBg.setAttribute("stroke-width", "1");
    const addTxt = ns("text");
    addTxt.setAttribute("x", node.x);
    addTxt.setAttribute("y", node.y + NODE_R + 38);
    addTxt.setAttribute("text-anchor", "middle");
    addTxt.setAttribute("font-size", "14");
    addTxt.setAttribute("font-family", "monospace");
    addTxt.setAttribute("fill", C.addColor);
    addTxt.textContent = "+";
    addG.appendChild(addBg);
    addG.appendChild(addTxt);
    addG.addEventListener("click", e => { e.stopPropagation(); handleAdd(node); });
    group.appendChild(addG);

    // Hover
    group.addEventListener("mouseenter", () => {
      circle.setAttribute("stroke", "#5b9cf6");
      addG.style.opacity = "1";
    });
    group.addEventListener("mouseleave", () => {
      circle.setAttribute("stroke", active ? C.nodeActiveBorder : C.nodeBorder);
      addG.style.opacity = "0";
    });

    // Click — ONLY update highlight, never rebuild tree
    group.addEventListener("click", () => {
      if (node.isVariant && !node.isActiveVariant) {
        // Suppress the update() that navTo's scanAndRender will trigger
        suppressNextUpdate = true;
        api.navTo({ turnIndex: node.forkTurnIdx }, node.variantNum)
          .then(() => {
            suppressNextUpdate = false;
            markVariantActive(node.parentTurnIndex, node.variantNum);
            const data = api.getData();
            recomputeActive({ ...data, activeMsgIndex: node.turnIndex });
            repaintHighlight();
            api.scrollToTurn(node.turnIndex);
          });
      } else {
        // Just update highlight + scroll
        const data = api.getData();
        recomputeActive({ ...data, activeMsgIndex: node.turnIndex });
        repaintHighlight();
        api.scrollToTurn(node.turnIndex);
      }
    });

    g.appendChild(group);
  }

  // Update isActiveVariant on all nodes with matching parentTurnIndex
  function markVariantActive(parentTurnIndex, variantNum) {
    walk(treeRoot, node => {
      if (node.isVariant && node.parentTurnIndex === parentTurnIndex) {
        node.isActiveVariant = (node.variantNum === variantNum);
        // Update badge color live
        const g = svg.querySelector(`[data-nodeid="${CSS.escape(node.id)}"]`);
        if (g) {
          const bc = g.querySelectorAll("circle")[2]; // badge circle
          if (bc) bc.setAttribute("fill", node.isActiveVariant ? "#3d7eff" : "#2a2a2a");
        }
      }
    });
  }

  function handleAdd(node) {
    const data = api.getData();
    if (node.isVariant) {
      api.navTo({ turnIndex: node.forkTurnIdx }, node.variantNum)
        .then(() => api.forkFromTurn(node.turn, null, false));
      return;
    }
    if (node.fork) {
      api.forkFromTurn(node.turn, null, false);
    } else {
      api.scrollToTurn(node.turnIndex);
      const input = document.querySelector("#prompt-textarea")
        || document.querySelector("[contenteditable='true'][data-id]");
      input?.focus();
    }
  }

  function drawLegend() {
    const fo = ns("foreignObject");
    fo.setAttribute("x", 8); fo.setAttribute("y", 8);
    fo.setAttribute("width", 160); fo.setAttribute("height", 90);
    fo.style.pointerEvents = "none";
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="
      background:rgba(20,20,20,0.88);border:1px solid #2e2e2e;
      border-radius:7px;padding:7px 10px;font-size:9.5px;color:#555;
      font-family:monospace;display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;align-items:center;gap:5px">
        <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#1a1a2e" stroke="#3d7eff" stroke-width="1.5"/></svg>
        Active path
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#1c1c1c" stroke="#444" stroke-width="1.5"/></svg>
        Other node
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="#f5a623"/></svg>
        Has branches
      </div>
      <div style="display:flex;align-items:center;gap:5px">
        <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#3d7eff" stroke-width="2.5"/></svg>
        Active edge
      </div>
    </div>`;
    svg.appendChild(fo);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function walk(node, fn) {
    if (!node) return;
    fn(node);
    node.children.forEach(c => walk(c, fn));
  }

  return { initGraph, update, setActiveNode };
})();
