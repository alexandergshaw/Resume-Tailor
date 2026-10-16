import type { Candidate, Finding, LoopState, Residual, Worker } from './types';
import type { LoopStore } from './store';

export type RoleProfile = 'execution' | 'analysis' | 'critical';
export type AdapterKind = 'codex' | 'claude' | 'gemini' | 'command';
export type DispatchRole = 'criteria' | 'architect' | 'specialist' | 'planner' | 'implementer' | 'checker' | 'verifier' | 'test-designer' | 'transcriber' | 'finalizer';
export type AdapterCapabilities = { freshSession: boolean; structuredOutput: boolean; readFiles: boolean; writeFiles: boolean; observedModel: boolean; nativeCostCap: boolean };
export type ProviderConfig = { id: string; kind: AdapterKind; enabled: boolean; executable: string; prefixArgs: string[]; environmentKeys: string[]; settings: Record<string, string>; timeoutMs: number; maxOutputBytes: number };
export type ModelTarget = { id: string; provider: string; model: string; settings: Record<string, string>; enabled: boolean; maxContextTokens: number; inputMicroUsdPerMillion: number | null; outputMicroUsdPerMillion: number | null };
export type Qualification = { schemaVersion: 1; id: string; target: string; targetHash: string; adapterVersion: string; executableHash: string; suiteVersion: string; profiles: RoleProfile[]; score: number; expires: number; evidencePath: string; evidenceHash: string; authority: 'operator' | 'evaluation' };
export type RoutingConfig = { schemaVersion: 1; providers: ProviderConfig[]; targets: ModelTarget[]; qualifications: Qualification[]; profiles: Record<RoleProfile, { minimumScore: number; requireObservedModel: boolean }>; roleProfiles: Record<DispatchRole, RoleProfile>; budget: { maxJobs: number; deadline: number; maxMicroUsd: number | null; mode: 'estimated' | 'provider-enforced' | 'unbounded'; allowUnavailableUsage: boolean }; grant: { owner: string; pathPrefixes: string[]; gateNames: string[]; artifactDirectory: string; allowConfigure: boolean; allowLocalDelivery: boolean } };
export type ProviderProbe = { schemaVersion: 1; provider: string; adapterVersion: string; executableHash: string; cliVersion: string | null; availability: 'available' | 'unavailable'; authentication: 'observed' | 'unknown' | 'unavailable'; capabilities: AdapterCapabilities; checked: number; reasons: string[] };
export type RouteRequest = { role: DispatchRole; profile: RoleProfile; estimatedInputTokens: number; reservedOutputTokens: number; requireWrites: boolean; authors: Worker[]; now: number };
export type RouteChoice = { target: ModelTarget; provider: ProviderConfig; qualification: Qualification; profile: RoleProfile; reservedMicroUsd: number | null; reasons: string[] };
export type RouteResult = { choice: RouteChoice | null; rejected: Record<string, string[]> };
export type ScopeProposal = { schemaVersion: 1; item: string; affectedPaths: string[]; writePaths: string[]; gateNames: string[]; triage: Record<string, string>; limitations: string[] };
export type CriteriaProposal = { schemaVersion: 1; item: string; criteria: Record<string, string>; leverage: string; diagnostics: string; limitations: string[] };
export type PlanWave = { id: string; objective: string; requirements: string[]; affectedPaths: string[]; writePaths: string[]; dependencies: string[]; gateNames: string[] };
export type PlanProposal = { schemaVersion: 1; item: string; waves: PlanWave[]; specialistKinds: string[]; limitations: string[] };
export type AcceptedBody = { id: string; hash: string } & ({ kind: 'scope'; value: ScopeProposal } | { kind: 'criteria'; value: CriteriaProposal } | { kind: 'plan'; value: PlanProposal });
export type ConfigureObservation = { configHash: string; grant: RoutingConfig['grant']; scope: { artifact: string; hash: string; proposal: ScopeProposal }; criteria: { artifact: string; hash: string; proposal: CriteriaProposal } };
export type TaskSpec = { id: string; item: string; activity: string; kind: string; role: DispatchRole; purpose: 'author' | 'review' | 'repair' | 'transcription'; requirementIds: string[]; acceptedInputs: Record<string, string>; affectedPaths: string[]; writePaths: string[]; resources: string[]; artifactIds: string[]; gateNames: string[]; wave: string | null; instructions: string };
export type NormalizedUsage = { source: 'observed' | 'unavailable'; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null };
export type IdentityObservation = { provider: string | null; model: string | null; settings: Record<string, string> | null; session: string | null; source: 'provider-output' | 'unavailable' };
export type WorkerArtifact = { id: string; path: string; content: string };
export type WorkerOutcome = { schemaVersion: 1; job: string; assignment: string; publicationToken: string; packetHash: string; inputHashes: Record<string, string>; candidateDigest: string; worker: Worker; status: 'completed' | 'failed' | 'needs-owner'; artifacts: WorkerArtifact[]; review: { artifact: string; hash: string; verdict: 'clean' | 'defective'; findings: Finding[] } | null; proposal: ScopeProposal | CriteriaProposal | PlanProposal | null; criterionEvidence: Record<string, string[]> | null; residuals: Residual[]; limitations: string[]; failure: string | null };
export type Invocation = { executable: string; args: string[]; cwd: string; environment: NodeJS.ProcessEnv; stdin: string; resultPath: string; timeoutMs: number; maxOutputBytes: number };
export type InvocationRequest = { provider: ProviderConfig; target: ModelTarget; worker: Worker; packet: unknown; packetHash: string; job: string; assignment: string; publicationToken: string; resultPath: string; workspace: string; nativeCostCapMicroUsd: number | null };
export type CapturedProcess = { exitCode: number | null; stdout: string; stderr: string; terminated: boolean; started: number; finished: number };
export type NormalizedResult = { outcome: WorkerOutcome | null; observed: IdentityObservation; usage: NormalizedUsage; limitations: string[]; errors: string[] };
export type LaunchStatus = 'prepared' | 'pending' | 'running' | 'terminated' | 'unknown' | 'imported' | 'rejected';
export type LaunchRecord = { id: string; actionKey: string; item: string; assignment: string; operation: string; worker: Worker; route: RouteChoice; task: TaskSpec; packetPath: string; packetHash: string; inboxPath: string; candidate: Candidate; inputHashes: Record<string, string>; publicationToken: string; status: LaunchStatus; pid: number | null; observed: IdentityObservation; usage: NormalizedUsage; reservedMicroUsd: number | null; outputHash: string | null; resultHash: string | null; rejection: string | null; created: number; finished: number | null; importedEvents: string[] };
export type DispatchJournal = { schemaVersion: 1; revision: number; configHash: string; jobs: Record<string, LaunchRecord>; probes: Record<string, ProviderProbe>; reservationsMicroUsd: number; spentMicroUsd: number; unavailableUsageJobs: string[]; checkpoints: Record<string, string> };
export type BacklogSelection = { id: string; objective: string; owns: string[]; verify: string | null; requirements: string[]; sourcePath: string; sourceHash: string; sourceKind: 'backlog' | 'workflow' };
export type NextAction =
  | { kind: 'bootstrap'; key: string; selection: BacklogSelection }
  | { kind: 'create-activity'; key: string; task: TaskSpec }
  | { kind: 'dispatch'; key: string; task: TaskSpec }
  | { kind: 'gate'; key: string; assignment: string; gate: string }
  | { kind: 'import-inbox'; key: string; job: string }
  | { kind: 'configure'; key: string; item: string; scopeArtifact: string; criteriaArtifact: string }
  | { kind: 'advance'; key: string; item: string; status: string; artifacts: string[]; evidence: string[] }
  | { kind: 'owner-needed' | 'blocked' | 'complete'; key: string; item: string; reasons: string[] };
export type ActionContext = { candidate: Candidate; now: number; selection: BacklogSelection; config: RoutingConfig; acceptedBodies: Record<string, AcceptedBody> };
export type DispatchStatus = { runStatus: LoopState['runStatus']; revision: number; journalRevision: number; candidate: Candidate; actions: NextAction[]; jobs: LaunchRecord[]; checkpoints: Record<string, string>; limitations: string[] };
export type DriveResult = { steps: number; status: DispatchStatus };

// Router/provider modules implement these contracts; the supervisor owns processes.
export type RouteFunction = (config: RoutingConfig, probes: ProviderProbe[], journal: DispatchJournal, request: RouteRequest) => RouteResult;
export type ProbeFunction = (provider: ProviderConfig) => Promise<ProviderProbe>;
export type InvocationFunction = (request: InvocationRequest) => Invocation;
export type NormalizeFunction = (provider: ProviderConfig, captured: CapturedProcess, resultBytes: string | null) => NormalizedResult;
export type NextActionsFunction = (state: LoopState, journal: DispatchJournal, context: ActionContext) => NextAction[];
export type ConfigureDispatchFunction = (store: LoopStore, config: RoutingConfig) => Promise<DispatchJournal>;
export type DriveFunction = (store: LoopStore, config: RoutingConfig, selection: BacklogSelection, options?: { maxSteps?: number }) => Promise<DriveResult>;
export type DispatchStatusFunction = (store: LoopStore, config: RoutingConfig, selection?: BacklogSelection) => Promise<DispatchStatus>;
export type ControlDispatchFunction = (store: LoopStore, config: RoutingConfig, action: 'pause' | 'resume' | 'cancel', reason: string) => Promise<DispatchStatus>;
export type RecoverDispatchFunction = (store: LoopStore, config: RoutingConfig, options: { acknowledgement: string; job?: string }) => Promise<DispatchStatus>;
export type ImportInboxFunction = (store: LoopStore, config: RoutingConfig, job: string) => Promise<DispatchStatus>;
