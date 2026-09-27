/**
 * `sessionBridge` namespace dictionaries.
 *
 * Registered through the client locale service so the chip follows the
 * application's active locale instead of guessing from the browser.
 *
 * @module dsh-session-bridge/client/locales
 */

/** The locale namespace this client half owns. */
export const NS = 'sessionBridge'

/** Simplified Chinese dictionary — the key set is the source of truth. */
export const zh = {
  'delete.action': '删除会话…',
  'delete.title': '删除聊天记录？',
  'delete.description': '此操作将永久删除该会话的聊天记录，无法撤销。工作区里的实际文件会保留。',
  'delete.confirm': '确认删除',
  'delete.pending': '正在删除…',
  'delete.done': '聊天记录已删除',
  'delete.notArchived': '该会话已取消归档，请先归档后再删除。',
  'delete.busy': '会话仍在运行或被其他进程占用，请停止活动或关闭占用它的应用后重试。',
  'delete.children': '该会话还有派生会话。请先处理派生会话，再删除原会话。',
  'delete.unsupported': '当前宿主尚不支持删除聊天记录，请更新应用后重试。',
  'delete.failed': '删除未完成，请重试。',
  'chip.copy': '复制会话 ID',
  'chip.copied': '已复制',
  'chip.failed': '复制失败',
  'chip.open': '会话标识与位置',
  'menu.copyCwd': '复制工作目录',
  'menu.copyBridge': '复制 /bridge 引用',
  'menu.cwdUnavailable': '暂时无法读取此会话的工作目录',
  'panel.title': '会话标识',
  'panel.id': '会话 ID',
  'panel.cwd': '工作目录',
  'panel.cwdUnknown': '（未知）',
  'panel.bridge': '在其他会话里引用',
  'panel.bridgeHint': '复制后在另一个会话的输入框里粘贴，即可给它发消息。',
  'panel.copyField': '复制{field}',
  'panel.close': '关闭',
  'picker.addWorkspace': '添加工作区…',
  'picker.scratch': '不在工作区（临时目录）…',
  'picker.scratchTitle': '不在工作区',
  'picker.starting': '正在创建临时目录…',
  'picker.loading': '加载中…',
  'picker.defaultWorkspace': '默认工作区',
  'picker.cancel': '取消',
  'picker.errorTitle': '无法完成',
  'picker.scratchHint': '使用同一个临时目录和名为「不在工作区」的工作区，保留现有项目。',
} as const

/** Key domain of the `sessionBridge` namespace. */
export type SessionBridgeKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SessionBridgeKey, string> = {
  'delete.action': 'Delete session…',
  'delete.title': 'Delete chat history?',
  'delete.description': 'This permanently deletes this session’s chat history and cannot be undone. Files in the workspace are kept.',
  'delete.confirm': 'Delete permanently',
  'delete.pending': 'Deleting…',
  'delete.done': 'Chat history deleted',
  'delete.notArchived': 'This session was unarchived. Archive it before deleting.',
  'delete.busy': 'This session is running or owned by another process. Stop its activity or close the app using it, then retry.',
  'delete.children': 'This session has derived sessions. Handle those before deleting their parent.',
  'delete.unsupported': 'This Host cannot delete chat history yet. Update the application and retry.',
  'delete.failed': 'Deletion did not complete. Please retry.',
  'chip.copy': 'Copy session ID',
  'chip.copied': 'Copied',
  'chip.failed': 'Copy failed',
  'chip.open': 'Session identity and location',
  'menu.copyCwd': 'Copy working directory',
  'menu.copyBridge': 'Copy /bridge reference',
  'menu.cwdUnavailable': 'This session’s working directory is not available yet',
  'panel.title': 'Session identity',
  'panel.id': 'Session ID',
  'panel.cwd': 'Working directory',
  'panel.cwdUnknown': '(unknown)',
  'panel.bridge': 'Reference from another session',
  'panel.bridgeHint': 'Paste this into another session\'s composer to message this one.',
  'panel.copyField': 'Copy {field}',
  'panel.close': 'Close',
  'picker.addWorkspace': 'Add workspace…',
  'picker.scratch': 'Outside a workspace (temp folder)…',
  'picker.scratchTitle': 'Outside a workspace',
  'picker.starting': 'Creating a temp folder…',
  'picker.loading': 'Loading…',
  'picker.defaultWorkspace': 'Default workspace',
  'picker.cancel': 'Cancel',
  'picker.errorTitle': 'Could not complete',
  'picker.scratchHint': 'Reuse one temporary folder and a workspace named "Outside a workspace", leaving existing projects unchanged.',
}
