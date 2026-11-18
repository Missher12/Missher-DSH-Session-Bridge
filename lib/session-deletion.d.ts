import type { HostContext } from './dsh.ts';
export interface SessionDeletion {
    deleteSession(id: string): Promise<void>;
}
/** Do not advertise the known 0.1.0 controller while the safe adapter is absent. */
export declare function hasLegacyDeletion(controller: object): boolean;
/** Install for a reviewed composition, including the old lifecycle decorator. */
export declare function registerSessionDeletion(ctx: HostContext): () => JsonlDeletion | undefined;
/** One reviewed service instance; exported for genuine Host integration checks. */
export declare class JsonlDeletion implements SessionDeletion {
    private readonly ctx;
    private readonly persistence;
    private readonly workspace;
    private readonly query;
    private readonly cache;
    private readonly agents;
    private readonly legacy;
    private leaseClass?;
    private root;
    private records;
    private movesDirectory?;
    private openWriter?;
    private lockDirectory;
    private closing;
    private tail;
    private readonly pending;
    private readonly mutating;
    private readonly moveRecords;
    private readonly placements;
    private readonly handles;
    private readonly ownership;
    private readonly restore;
    constructor(ctx: HostContext);
    initialize(): Promise<void>;
    deleteSession(id: string): Promise<void>;
    get canMove(): boolean;
    moveSession(id: string, target: string): Promise<void>;
    private mutate;
    /** Refuse queued or background work before releasing the API controller's writer. */
    private releaseIdle;
    private mountMovement;
    private completeMove;
    dispose(): Promise<void>;
    /** Preserve the caller's traced `this`; never bind registry methods to our scope. */
    private wrap;
    private guardStorage;
    private captureOwnership;
    private inLineage;
    private record;
    private readRecord;
    private writeRecord;
    private sessionDirectory;
    private artifacts;
    private complete;
    private cleanup;
    private assertNoChildren;
    /** The Host can retain a queue after its Agent goes cold. Never wake it here. */
    private assertStoredIdle;
    private forgetHeader;
    private syncDirectory;
}
