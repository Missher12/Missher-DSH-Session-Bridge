/** Check the consumed API declarations against a built DSH checkout; no runtime import is made. */
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

if (!process.argv[2]) throw new Error('usage: node scripts/check-host-contracts.mjs <DSH checkout>')
const host = await realpath(process.argv[2])
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'bridge-contracts-'))
const from = path => JSON.stringify(resolve(host, path))
const local = path => JSON.stringify(resolve(root, path))
try {
  const filename = join(directory, 'contracts.mts')
  await writeFile(filename, `
import type { HostConnectionHandle } from ${from('packages/client/connection/lib/types/index.d.ts')};
import type { IWorkspaces } from ${from('packages/api/workspace-controller/lib/types/client/index.d.ts')};
import type { ISessions } from ${from('packages/api/session-controller/lib/types/client/index.d.ts')};
import type { UiWorkspace } from ${from('packages/client/ui-workspace/lib/types/client/index.d.ts')};
import type { SessionController } from ${from('packages/api/session-controller/lib/types/index.d.ts')};
import type { SessionControllerLike } from ${local('src/dsh.ts')};
import type { WorkspaceRegistry } from ${from('packages/workspace/workspace/lib/types/index.d.ts')};
import type { ScratchConnection } from ${local('src/scratch-route.ts')};
import type { ClientContextLike } from ${local('src/client/index.tsx')};
import type { WorkspaceRegistryLike } from ${local('src/dsh.ts')};
declare const hostConnection: HostConnectionHandle;
declare const workspaces: IWorkspaces;
declare const sessions: ISessions;
declare const uiWorkspace: UiWorkspace;
declare const registry: WorkspaceRegistry;
declare const controller: SessionController;
type HostDeletion = SessionController extends { deleteArchivedSession: infer Method }
  ? { deleteArchivedSession: Method } : { deleteArchivedSession?: never };
declare const optionalDeletion: HostDeletion;
const deletion: Pick<SessionControllerLike, 'deleteArchivedSession'> = optionalDeletion;
const hostFetch: ScratchConnection = hostConnection;
const clientStore: ClientContextLike['workspaces'] = workspaces;
const sessionSummaries: ClientContextLike['sessions'] = sessions;
const picker: ClientContextLike['uiWorkspace'] = uiWorkspace;
const workspaceCreate: Pick<WorkspaceRegistryLike, 'create'> = registry;
`)
  const program = ts.createProgram([filename], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX,
    allowImportingTsExtensions: true, types: ['node', 'react'],
    typeRoots: [join(root, 'node_modules/@types')],
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }))
    process.exitCode = 1
  } else console.log('DSH Host Connection Fetch, workspace create and native picker declarations match')
} finally { await rm(directory, { recursive: true, force: true }) }
