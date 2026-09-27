window.__ModuleLoader__.load({
  id: "dsh-session-bridge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  ScratchWorkspacePicker: () => ScratchWorkspacePicker,
  SessionIdChip: () => SessionIdChip,
  apply: () => apply,
  copyPayload: () => copyPayload,
  createSessionCopyActions: () => createSessionCopyActions,
  createSessionDeleteActions: () => createSessionDeleteActions,
  inject: () => inject,
  scratchPickerInjected: () => scratchPickerInjected,
  shortenSessionId: () => shortenSessionId,
  writeClipboard: () => writeClipboard
});
module.exports = __toCommonJS(index_exports);

// src/client/SessionIdChip.tsx
var import_react = require("react");

// src/client/clipboard.ts
var SHORT_HEAD = 8;
var SHORT_TAIL = 4;
function shortenSessionId(sessionId) {
  const body = sessionId.startsWith("session-") ? sessionId.slice("session-".length) : sessionId;
  if (body.length <= SHORT_HEAD + SHORT_TAIL + 1) return body;
  return `${body.slice(0, SHORT_HEAD)}\u2026${body.slice(-SHORT_TAIL)}`;
}
function copyPayload(key, sessionId, cwd) {
  switch (key) {
    case "id":
      return { key, text: sessionId };
    case "cwd":
      return cwd === void 0 || cwd.length === 0 ? void 0 : { key, text: cwd };
    case "bridge":
      return { key, text: `/bridge ${sessionId} ` };
  }
}
async function writeClipboard(text3, host = globalThis) {
  const clipboard = host.navigator?.clipboard;
  if (clipboard !== void 0) {
    try {
      await clipboard.writeText(text3);
      return "copied";
    } catch {
    }
  }
  const doc = host.document;
  if (doc === void 0 || typeof doc.execCommand !== "function") return "failed";
  try {
    const scratch = doc.createElement("textarea");
    scratch.value = text3;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.top = "0";
    scratch.style.left = "0";
    scratch.style.opacity = "0";
    scratch.style.pointerEvents = "none";
    doc.body.appendChild(scratch);
    scratch.select();
    const ok = doc.execCommand("copy");
    scratch.remove();
    return ok ? "copied" : "failed";
  } catch {
    return "failed";
  }
}

// src/client/locales.ts
var NS = "sessionBridge";
var zh = {
  "delete.action": "\u5220\u9664\u4F1A\u8BDD\u2026",
  "delete.title": "\u5220\u9664\u804A\u5929\u8BB0\u5F55\uFF1F",
  "delete.description": "\u6B64\u64CD\u4F5C\u5C06\u6C38\u4E45\u5220\u9664\u8BE5\u4F1A\u8BDD\u7684\u804A\u5929\u8BB0\u5F55\uFF0C\u65E0\u6CD5\u64A4\u9500\u3002\u5DE5\u4F5C\u533A\u91CC\u7684\u5B9E\u9645\u6587\u4EF6\u4F1A\u4FDD\u7559\u3002",
  "delete.confirm": "\u786E\u8BA4\u5220\u9664",
  "delete.pending": "\u6B63\u5728\u5220\u9664\u2026",
  "delete.done": "\u804A\u5929\u8BB0\u5F55\u5DF2\u5220\u9664",
  "delete.notArchived": "\u8BE5\u4F1A\u8BDD\u5DF2\u53D6\u6D88\u5F52\u6863\uFF0C\u8BF7\u5148\u5F52\u6863\u540E\u518D\u5220\u9664\u3002",
  "delete.busy": "\u4F1A\u8BDD\u4ECD\u5728\u8FD0\u884C\u6216\u88AB\u5176\u4ED6\u8FDB\u7A0B\u5360\u7528\uFF0C\u8BF7\u505C\u6B62\u6D3B\u52A8\u6216\u5173\u95ED\u5360\u7528\u5B83\u7684\u5E94\u7528\u540E\u91CD\u8BD5\u3002",
  "delete.children": "\u8BE5\u4F1A\u8BDD\u8FD8\u6709\u6D3E\u751F\u4F1A\u8BDD\u3002\u8BF7\u5148\u5904\u7406\u6D3E\u751F\u4F1A\u8BDD\uFF0C\u518D\u5220\u9664\u539F\u4F1A\u8BDD\u3002",
  "delete.unsupported": "\u5F53\u524D\u5BBF\u4E3B\u5C1A\u4E0D\u652F\u6301\u5220\u9664\u804A\u5929\u8BB0\u5F55\uFF0C\u8BF7\u66F4\u65B0\u5E94\u7528\u540E\u91CD\u8BD5\u3002",
  "delete.failed": "\u5220\u9664\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  "chip.copy": "\u590D\u5236\u4F1A\u8BDD ID",
  "chip.copied": "\u5DF2\u590D\u5236",
  "chip.failed": "\u590D\u5236\u5931\u8D25",
  "chip.open": "\u4F1A\u8BDD\u6807\u8BC6\u4E0E\u4F4D\u7F6E",
  "menu.copyCwd": "\u590D\u5236\u5DE5\u4F5C\u76EE\u5F55",
  "menu.copyBridge": "\u590D\u5236 /bridge \u5F15\u7528",
  "menu.cwdUnavailable": "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u7684\u5DE5\u4F5C\u76EE\u5F55",
  "panel.title": "\u4F1A\u8BDD\u6807\u8BC6",
  "panel.id": "\u4F1A\u8BDD ID",
  "panel.cwd": "\u5DE5\u4F5C\u76EE\u5F55",
  "panel.cwdUnknown": "\uFF08\u672A\u77E5\uFF09",
  "panel.bridge": "\u5728\u5176\u4ED6\u4F1A\u8BDD\u91CC\u5F15\u7528",
  "panel.bridgeHint": "\u590D\u5236\u540E\u5728\u53E6\u4E00\u4E2A\u4F1A\u8BDD\u7684\u8F93\u5165\u6846\u91CC\u7C98\u8D34\uFF0C\u5373\u53EF\u7ED9\u5B83\u53D1\u6D88\u606F\u3002",
  "panel.copyField": "\u590D\u5236{field}",
  "panel.close": "\u5173\u95ED",
  "picker.addWorkspace": "\u6DFB\u52A0\u5DE5\u4F5C\u533A\u2026",
  "picker.scratch": "\u4E0D\u5728\u5DE5\u4F5C\u533A\uFF08\u4E34\u65F6\u76EE\u5F55\uFF09\u2026",
  "picker.scratchTitle": "\u4E0D\u5728\u5DE5\u4F5C\u533A",
  "picker.starting": "\u6B63\u5728\u521B\u5EFA\u4E34\u65F6\u76EE\u5F55\u2026",
  "picker.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "picker.defaultWorkspace": "\u9ED8\u8BA4\u5DE5\u4F5C\u533A",
  "picker.cancel": "\u53D6\u6D88",
  "picker.errorTitle": "\u65E0\u6CD5\u5B8C\u6210",
  "picker.scratchHint": "\u4F7F\u7528\u540C\u4E00\u4E2A\u4E34\u65F6\u76EE\u5F55\u548C\u540D\u4E3A\u300C\u4E0D\u5728\u5DE5\u4F5C\u533A\u300D\u7684\u5DE5\u4F5C\u533A\uFF0C\u4FDD\u7559\u73B0\u6709\u9879\u76EE\u3002"
};
var en = {
  "delete.action": "Delete session\u2026",
  "delete.title": "Delete chat history?",
  "delete.description": "This permanently deletes this session\u2019s chat history and cannot be undone. Files in the workspace are kept.",
  "delete.confirm": "Delete permanently",
  "delete.pending": "Deleting\u2026",
  "delete.done": "Chat history deleted",
  "delete.notArchived": "This session was unarchived. Archive it before deleting.",
  "delete.busy": "This session is running or owned by another process. Stop its activity or close the app using it, then retry.",
  "delete.children": "This session has derived sessions. Handle those before deleting their parent.",
  "delete.unsupported": "This Host cannot delete chat history yet. Update the application and retry.",
  "delete.failed": "Deletion did not complete. Please retry.",
  "chip.copy": "Copy session ID",
  "chip.copied": "Copied",
  "chip.failed": "Copy failed",
  "chip.open": "Session identity and location",
  "menu.copyCwd": "Copy working directory",
  "menu.copyBridge": "Copy /bridge reference",
  "menu.cwdUnavailable": "This session\u2019s working directory is not available yet",
  "panel.title": "Session identity",
  "panel.id": "Session ID",
  "panel.cwd": "Working directory",
  "panel.cwdUnknown": "(unknown)",
  "panel.bridge": "Reference from another session",
  "panel.bridgeHint": "Paste this into another session's composer to message this one.",
  "panel.copyField": "Copy {field}",
  "panel.close": "Close",
  "picker.addWorkspace": "Add workspace\u2026",
  "picker.scratch": "Outside a workspace (temp folder)\u2026",
  "picker.scratchTitle": "Outside a workspace",
  "picker.starting": "Creating a temp folder\u2026",
  "picker.loading": "Loading\u2026",
  "picker.defaultWorkspace": "Default workspace",
  "picker.cancel": "Cancel",
  "picker.errorTitle": "Could not complete",
  "picker.scratchHint": 'Reuse one temporary folder and a workspace named "Outside a workspace", leaving existing projects unchanged.'
};

// src/client/SessionIdChip.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var ACK_MS = 1600;
function text(t, key, params) {
  if (t === void 0) {
    const pattern = en[key];
    if (params === void 0) return pattern;
    return pattern.replace(/\{(\w+)\}/g, (match, name) => params[name] === void 0 ? match : String(params[name]));
  }
  return t(key, params);
}
function CopyIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: "11", height: "11", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "5.75", y: "5.75", width: "8.5", height: "8.5", rx: "2", stroke: "currentColor", strokeWidth: "1.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "path",
      {
        d: "M10.25 3.75A2 2 0 0 0 8.25 1.75h-4.5a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2",
        stroke: "currentColor",
        strokeWidth: "1.4",
        strokeLinecap: "round"
      }
    )
  ] });
}
function CheckIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "11", height: "11", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "path",
    {
      d: "M3.5 8.5 6.5 11.5 12.5 5",
      stroke: "currentColor",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }
  ) });
}
function CaretIcon({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: "10",
      height: "10",
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      className: open ? "dsh-sbc-caretGlyph dsh-sbc-caretOpen" : "dsh-sbc-caretGlyph",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "path",
        {
          d: "M4 6.5 8 10.5 12 6.5",
          stroke: "currentColor",
          strokeWidth: "1.6",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      )
    }
  );
}
function Row({ fieldKey, label, value, hint, payload, state, onCopy, t }) {
  const copyable = payload !== void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-sbc-row", "data-field": fieldKey, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-sbc-rowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-sbc-rowLabel", children: label }),
      copyable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-sbc-rowCopy",
          "data-copy-state": state ?? "idle",
          "aria-label": text(t, "panel.copyField", { field: label }),
          title: state === "copied" ? text(t, "chip.copied") : text(t, "panel.copyField", { field: label }),
          onClick: () => {
            onCopy(payload);
          },
          children: state === "copied" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyIcon, {})
        }
      ) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "dsh-sbc-rowValue", title: value, children: value }),
    hint !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-sbc-rowHint", children: hint }) : null
  ] });
}
function SessionIdChip({ sessionId, useSessions, t }) {
  const cwd = useSessions === void 0 ? void 0 : useSessions((snapshot) => snapshot?.byId?.[sessionId]?.cwd);
  const [open, setOpen] = (0, import_react.useState)(false);
  const [ack, setAck] = (0, import_react.useState)(void 0);
  const rootRef = (0, import_react.useRef)(null);
  const caretRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (ack === void 0) return;
    const timer = setTimeout(() => {
      setAck(void 0);
    }, ACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [ack]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);
  const copy = async (payload) => {
    if (payload === void 0) return;
    const outcome = await writeClipboard(payload.text);
    setAck({ key: payload.key, outcome });
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    caretRef.current?.focus();
  };
  const idPayload = copyPayload("id", sessionId, cwd);
  const cwdPayload = copyPayload("cwd", sessionId, cwd);
  const bridgePayload = copyPayload("bridge", sessionId, cwd);
  const chipAck = ack?.key === "id" ? ack.outcome : void 0;
  const chipLabel = chipAck === "copied" ? text(t, "chip.copied") : chipAck === "failed" ? text(t, "chip.failed") : text(t, "chip.copy");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: rootRef, className: "dsh-sbc-root", "data-session-id": sessionId, onKeyDown, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dsh-sbc-chip",
        "data-copy-state": chipAck ?? "idle",
        "aria-label": chipLabel,
        title: `${text(t, "chip.copy")} \xB7 ${sessionId}`,
        onClick: () => {
          void copy(idPayload);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-sbc-chipId", children: shortenSessionId(sessionId) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-sbc-chipIcon", children: chipAck === "copied" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyIcon, {}) })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        ref: caretRef,
        type: "button",
        className: "dsh-sbc-caret",
        "aria-expanded": open,
        "aria-label": text(t, "chip.open"),
        title: text(t, "chip.open"),
        onClick: () => {
          setOpen((current) => !current);
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CaretIcon, { open })
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-sbc-panel", role: "dialog", "aria-label": text(t, "panel.title"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-sbc-panelTitle", children: text(t, "panel.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Row,
        {
          fieldKey: "id",
          label: text(t, "panel.id"),
          value: sessionId,
          payload: idPayload,
          ...ack?.key === "id" ? { state: ack.outcome } : {},
          onCopy: (payload) => {
            void copy(payload);
          },
          ...t === void 0 ? {} : { t }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Row,
        {
          fieldKey: "cwd",
          label: text(t, "panel.cwd"),
          value: cwd === void 0 || cwd.length === 0 ? text(t, "panel.cwdUnknown") : cwd,
          payload: cwdPayload,
          ...ack?.key === "cwd" ? { state: ack.outcome } : {},
          onCopy: (payload) => {
            void copy(payload);
          },
          ...t === void 0 ? {} : { t }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Row,
        {
          fieldKey: "bridge",
          label: text(t, "panel.bridge"),
          value: bridgePayload?.text.trimEnd() ?? "",
          hint: text(t, "panel.bridgeHint"),
          payload: bridgePayload,
          ...ack?.key === "bridge" ? { state: ack.outcome } : {},
          onCopy: (payload) => {
            void copy(payload);
          },
          ...t === void 0 ? {} : { t }
        }
      )
    ] }) : null
  ] });
}

// src/client/ScratchWorkspacePicker.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
var ADD_WORKSPACE = "::add-workspace";
var SCRATCH = "::scratch-session";
function text2(t, key, params) {
  if (t !== void 0) return t(key, params);
  const pattern = en[key];
  if (params === void 0) return pattern;
  return pattern.replace(/\{(\w+)\}/g, (match, name) => params[name] === void 0 ? match : String(params[name]));
}
function messageOf(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}
function ScratchWorkspacePicker({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  createWorkspace,
  pickDirectory,
  findScratchWorkspace,
  startScratchSession,
  t
}) {
  const snapshot = useWorkspaces((state) => state);
  const workspaces = snapshot.items;
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [scratchWorkspaceId, setScratchWorkspaceId] = (0, import_react2.useState)(null);
  const [lookingUpScratch, setLookingUpScratch] = (0, import_react2.useState)(true);
  const workspaceIds = workspaces.map((workspace) => workspace.workspaceId).join("\0");
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const controller = new AbortController();
    setLookingUpScratch(true);
    void findScratchWorkspace(controller.signal).then((id) => {
      if (!controller.signal.aborted) setScratchWorkspaceId(id);
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setScratchWorkspaceId(null);
        setError(messageOf(reason));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLookingUpScratch(false);
    });
    return () => {
      controller.abort();
    };
  }, [open, workspaceIds, findScratchWorkspace]);
  const getAnchorRect = (0, import_react2.useCallback)(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef]
  );
  const adopt = async (path) => {
    const workspace = await createWorkspace({ path });
    onPick(workspace.workspaceId);
  };
  const chooseDirectory = () => {
    onClose();
    setBusy(true);
    void (async () => {
      try {
        const path = await pickDirectory();
        if (path !== null && path.length > 0) await adopt(path);
      } catch (reason) {
        setError(messageOf(reason));
      } finally {
        setBusy(false);
      }
    })();
  };
  const startScratch = () => {
    onClose();
    setBusy(true);
    void (async () => {
      try {
        const { workspaceId } = await startScratchSession(text2(t, "picker.scratchTitle"));
        onPick(workspaceId);
      } catch (reason) {
        setError(messageOf(reason));
      } finally {
        setBusy(false);
      }
    })();
  };
  const handleSelect = (id) => {
    if (id === ADD_WORKSPACE) {
      chooseDirectory();
      return;
    }
    if (id === SCRATCH) {
      startScratch();
      return;
    }
    onPick(id);
  };
  const workspaceItems = workspaces.map((workspace) => ({
    id: workspace.workspaceId,
    label: workspace.title,
    icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 16 }),
    disabled: busy
  }));
  const scratchListed = workspaces.some((workspace) => workspace.workspaceId === scratchWorkspaceId);
  const addEntries = [
    {
      id: ADD_WORKSPACE,
      label: text2(t, "picker.addWorkspace"),
      icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
      disabled: busy
    },
    ...!lookingUpScratch && !scratchListed ? [{
      id: SCRATCH,
      label: busy ? text2(t, "picker.starting") : text2(t, "picker.scratch"),
      icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconSparkleRegular, { size: 16 }),
      disabled: busy
    }] : []
  ];
  const pinAdd = workspaces.length > 0;
  const items = pinAdd ? workspaceItems : addEntries;
  const menuIsEmpty = items.length === 0;
  const closeModal = () => {
    setError(null);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives.Menu,
      {
        open: open && !menuIsEmpty,
        anchor: null,
        items,
        ...pinAdd ? { footer: addEntries } : {},
        selectedId,
        onSelect: handleSelect,
        onClose,
        side: "bottom",
        portal: true,
        getAnchorRect
      }
    ),
    open && !menuIsEmpty && (snapshot.phase === "pending" || lookingUpScratch) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-sbp-status", role: "status", children: text2(t, "picker.loading") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives.Modal,
      {
        open: error !== null,
        onClose: closeModal,
        closeLabel: text2(t, "panel.close"),
        title: text2(t, "picker.errorTitle"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: closeModal, children: text2(t, "picker.cancel") }),
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "alert", children: error })
      }
    ),
    open && !pinAdd && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-sbp-hint", role: "note", children: text2(t, "picker.scratchHint") })
  ] });
}

// src/scratch-wire.ts
var SCRATCH_PATH = "/api/session-bridge/ensure-workspace";
function scratchWorkspace(value) {
  if (typeof value !== "object" || value === null || !("workspaceId" in value) || !("path" in value) || !("title" in value) || typeof value.workspaceId !== "string" || value.workspaceId.length === 0 || typeof value.path !== "string" || value.path.length === 0 || typeof value.title !== "string" || value.title.length === 0) {
    throw new TypeError("session-bridge returned an invalid workspace");
  }
  return { workspaceId: value.workspaceId, path: value.path, title: value.title };
}

// src/client/session-menu.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
function createSessionCopyActions(sessions, write = writeClipboard) {
  const listeners = /* @__PURE__ */ new Set();
  let notice = null;
  let sequence = 0;
  let disposed = false;
  const publish = (value) => {
    if (disposed) return;
    notice = value;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => notice,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss: () => {
      publish(null);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      notice = null;
    },
    async copy(kind, sessionId) {
      if (disposed) return;
      const payload = copyPayload(kind, sessionId, sessions.list.getSnapshot().byId[sessionId]?.cwd);
      if (payload === void 0) {
        publish({ sequence: ++sequence, key: "menu.cwdUnavailable", success: false });
        return;
      }
      const success = await write(payload.text).then((outcome) => outcome === "copied", () => false);
      publish({ sequence: ++sequence, key: success ? "chip.copied" : "chip.failed", success });
    }
  };
}
function SessionCopyMenuItem({ sessionId, kind, copyReference, useMenuOpenState, t }) {
  const [, setMenuOpen] = useMenuOpenState();
  const key = { id: "chip.copy", cwd: "menu.copyCwd", bridge: "menu.copyBridge" }[kind];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.MenuItemButton, { separatorBefore: kind === "id", onSelect: () => {
    void copyReference(kind, sessionId);
    setMenuOpen(false);
  }, children: t === void 0 ? en[key] : t(key) });
}
function SessionCopyNotice({ copyActions, t }) {
  const notice = (0, import_react3.useSyncExternalStore)(copyActions.subscribe, copyActions.getSnapshot);
  if (notice === null) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    import_dsh_client_ui_primitives2.Toast,
    {
      text: t === void 0 ? en[notice.key] : t(notice.key),
      tone: notice.success ? "success" : void 0,
      onDone: copyActions.dismiss
    },
    notice.sequence
  );
}

// src/client/session-delete.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/session-delete-wire.ts
var SESSION_DELETE_PATH = "/api/session-bridge/delete-session";

// src/client/session-delete.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function createSessionDeleteActions(archive, send = fetch) {
  const listeners = /* @__PURE__ */ new Set();
  let state = null;
  let disposed = false;
  const publish = (next) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request(sessionId) {
      if (disposed || state?.pending || !archive.getSnapshot().archivedSessionIds.includes(sessionId)) return;
      publish({ sessionId, pending: false, done: false });
    },
    dismiss() {
      if (!state?.pending) publish(null);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      state = null;
    },
    async confirm() {
      if (disposed || state === null || state.pending || state.done) return;
      const { sessionId } = state;
      if (!archive.getSnapshot().archivedSessionIds.includes(sessionId)) {
        publish({ sessionId, pending: false, done: false, error: "delete.notArchived" });
        return;
      }
      publish({ sessionId, pending: true, done: false });
      try {
        const response = await send(SESSION_DELETE_PATH.slice(1), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, confirmed: true })
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true || result.value?.sessionId !== sessionId) {
          const key = {
            "session/delete-unsupported": "delete.unsupported",
            "session/delete-not-archived": "delete.notArchived",
            "session/delete-active": "delete.busy",
            "session/delete-owned": "delete.busy",
            "session/delete-busy": "delete.busy",
            "session/delete-has-children": "delete.children"
          }[result.error?.code ?? ""] ?? "delete.failed";
          publish({ sessionId, pending: false, done: false, error: key });
          return;
        }
        publish({ sessionId, pending: false, done: true });
      } catch {
        publish({ sessionId, pending: false, done: false, error: "delete.failed" });
      }
    }
  };
}
function SessionDeleteMenuItem({ sessionId, archive, deleteActions, useMenuOpenState, t }) {
  const [, setMenuOpen] = useMenuOpenState();
  const snapshot = (0, import_react4.useSyncExternalStore)(archive.subscribe, archive.getSnapshot);
  if (!snapshot.archivedSessionIds.includes(sessionId)) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.MenuItemButton, { danger: true, separatorBefore: true, onSelect: () => {
    setMenuOpen(false);
    deleteActions.request(sessionId);
  }, children: t === void 0 ? en["delete.action"] : t("delete.action") });
}
function SessionDeleteDialog({ deleteActions, t }) {
  const state = (0, import_react4.useSyncExternalStore)(deleteActions.subscribe, deleteActions.getSnapshot);
  const tr = t ?? ((key) => en[key]);
  if (state === null) return null;
  if (state.done) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Toast, { text: tr("delete.done"), tone: "success", onDone: deleteActions.dismiss });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    import_dsh_client_ui_primitives3.Modal,
    {
      open: true,
      title: tr("delete.title"),
      closeLabel: tr("panel.close"),
      description: tr("delete.description"),
      onClose: deleteActions.dismiss,
      footer: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: state.pending, "data-modal-autofocus": true, onClick: deleteActions.dismiss, children: tr("picker.cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", disabled: state.pending, onClick: () => {
          void deleteActions.confirm();
        }, children: tr(state.pending ? "delete.pending" : "delete.confirm") })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: state.sessionId }),
        state.error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", children: tr(state.error) })
      ]
    }
  );
}

// src/client/index.tsx
var inject = ["slots", "locale", "uiWorkspace", "workspaces", "sessions"];
var SLOT = "conversation.session.header.actions";
var ENTRY_ID = "session-identity";
var HERO_PICKER_SLOT = "conversation.hero.workspace";
var HERO_PICKER_ID = "session-bridge-picker";
var HERO_PICKER_PRIORITY = -1;
var ENTRY_ORDER = 0;
var STYLE_ID = "dsh-session-bridge-styles";
var STYLES = `
.dsh-sbc-root { position: relative; display: inline-flex; align-items: stretch; gap: 0; }
.dsh-sbc-chip, .dsh-sbc-caret {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 1; cursor: pointer;
  transition: color .12s ease, border-color .12s ease, background-color .12s ease;
}
.dsh-sbc-chip { border-radius: 6px 0 0 6px; border-right-width: 0; max-width: 132px; }
.dsh-sbc-caret { border-radius: 0 6px 6px 0; padding: 0 4px; }
.dsh-sbc-chip:hover, .dsh-sbc-caret:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sbc-chip:focus-visible, .dsh-sbc-caret:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px;
}
.dsh-sbc-chipId {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-sbc-chipIcon { display: inline-flex; opacity: .55; }
.dsh-sbc-chip:hover .dsh-sbc-chipIcon { opacity: 1; }
.dsh-sbc-chip[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-chip[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-sbc-caretGlyph { transition: transform .14s ease; }
.dsh-sbc-caretOpen { transform: rotate(180deg); }
.dsh-sbc-panel {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60;
  width: 384px; max-width: calc(100vw - 32px);
  padding: 10px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 10px 30px rgb(0 0 0 / 18%);
  display: flex; flex-direction: column; gap: 10px;
}
.dsh-sbc-panelTitle {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-row { display: flex; flex-direction: column; gap: 4px; }
.dsh-sbc-rowHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-sbc-rowLabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-sbc-rowCopy {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary);
}
.dsh-sbc-rowCopy:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.dsh-sbc-rowCopy[data-copy-state="copied"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsh-sbc-rowCopy[data-copy-state="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dsh-sbc-rowValue {
  display: block; padding: 5px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px; color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-sbc-rowHint { margin: 0; font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.dsh-sbp-status {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary);
  font-size: 12px; z-index: 60;
}
.dsh-sbp-hint {
  max-width: 420px; margin: 8px auto 0; padding: 0 12px;
  font-size: 12px; line-height: 1.5; text-align: center;
  color: var(--dsw-alias-label-secondary);
}
`;
function scratchPickerInjected(ctx) {
  return {
    createWorkspace: (input) => ctx.workspaces.create(input),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    findScratchWorkspace: async (signal) => {
      const response = await fetch(SCRATCH_PATH.slice(1), { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw new Error(`scratch lookup failed: HTTP ${response.status}`);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error.message);
      return result.value === null ? null : scratchWorkspace(result.value).workspaceId;
    },
    startScratchSession: async (title) => {
      const response = await fetch(SCRATCH_PATH.slice(1), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      if (!response.ok) throw new Error(`scratch request failed: HTTP ${response.status}`);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error.message);
      const workspace = scratchWorkspace(result.value);
      return await ctx.workspaces.create({ path: workspace.path });
    }
  };
}
function installStyles() {
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) existing.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.dataset.plugin = "dsh-session-bridge";
  style.dataset.pluginCss = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}
function apply(ctx) {
  const copyActions = createSessionCopyActions(ctx.sessions);
  const deleteActions = createSessionDeleteActions(ctx.workspaces.list);
  ctx.effect(() => () => {
    deleteActions.dispose();
  }, "session-bridge: deletion confirmation");
  ctx.effect(() => () => {
    copyActions.dispose();
  }, "session-bridge: sidebar actions");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-bridge: dictionaries");
  ctx.effect(installStyles, "session-bridge: styles");
  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: ENTRY_ID,
    order: ENTRY_ORDER,
    locale: NS
  }, SessionIdChip));
  ctx.slots.inject(HERO_PICKER_SLOT, () => ctx.slots.register({
    name: HERO_PICKER_SLOT,
    id: HERO_PICKER_ID,
    priority: HERO_PICKER_PRIORITY,
    locale: NS,
    inject: () => scratchPickerInjected(ctx)
  }, ScratchWorkspacePicker));
  const menu = "sidebar.workspaces.session.menu.item";
  for (const [index, kind] of ["id", "cwd", "bridge"].entries()) {
    ctx.slots.inject(menu, () => ctx.slots.register({
      name: menu,
      id: `dsh-session-bridge.copy-${kind}`,
      order: 500 + index * 10,
      locale: NS,
      inject: () => ({ kind, copyReference: copyActions.copy })
    }, SessionCopyMenuItem));
  }
  ctx.slots.inject(menu, () => ctx.slots.register({
    name: menu,
    id: "dsh-session-bridge.delete",
    order: 600,
    locale: NS,
    inject: () => ({ archive: ctx.workspaces.list, deleteActions })
  }, SessionDeleteMenuItem));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "dsh-session-bridge.delete-dialog",
    locale: NS,
    inject: () => ({ deleteActions })
  }, SessionDeleteDialog));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "dsh-session-bridge.copy-notice",
    locale: NS,
    inject: () => ({ copyActions })
  }, SessionCopyNotice));
}

    return module.exports;
  },
});
