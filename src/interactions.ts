import type {
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  FileUpdateChange,
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
} from "./protocol/v2/index.js";

/** Everything the server may ask the user mid-turn. The UI supplies a terminal implementation. */
export interface Interactions {
  approveCommand(req: CommandExecutionRequestApprovalParams): Promise<CommandExecutionApprovalDecision>;
  /** `changes` comes from the fileChange item; the approval request itself carries no diff. */
  approveFileChange(req: FileChangeRequestApprovalParams, changes: FileUpdateChange[]): Promise<FileChangeApprovalDecision>;
  approvePermissions(req: PermissionsRequestApprovalParams): Promise<PermissionsRequestApprovalResponse>;
  askUser(req: ToolRequestUserInputParams): Promise<ToolRequestUserInputResponse>;
  elicit(req: McpServerElicitationRequestParams): Promise<McpServerElicitationRequestResponse>;
}

/** Non-interactive fallback (one-shot mode, tests): refuse everything. */
export const declineAll: Interactions = {
  approveCommand: async () => "decline",
  approveFileChange: async () => "decline",
  approvePermissions: async () => ({ permissions: {}, scope: "turn" }),
  askUser: async () => ({ answers: {} }),
  elicit: async () => ({ action: "decline", content: null, _meta: null }),
};
