// Best-effort snapshot of known Claude Code tools. May not be exhaustive.
// For the authoritative list, check session_meta.tools from a live session.
//
// Declared as a literal tuple so `TBuiltInToolName` is the exact union of
// known names -- lets callers narrow `allowedTools` / `disallowedTools`
// arrays at compile time instead of accepting any string[].
export const BUILT_IN_TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "Agent",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TaskOutput",
  "ToolSearch",
  "Monitor",
  "EnterPlanMode",
  "ExitPlanMode",
  "SendMessage",
  "LSP",
  "AskUserQuestion",
  "Skill",
  "CronCreate",
  "CronDelete",
  "CronList",
  "RemoteTrigger",
  "TeamCreate",
  "TeamDelete",
  "EnterWorktree",
  "ExitWorktree",
  "ScheduleWakeup",
] as const;

export type TBuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

export const BUILT_IN_TOOLS: ReadonlySet<TBuiltInToolName> = new Set(BUILT_IN_TOOL_NAMES);

export const isBuiltInTool = (name: string): name is TBuiltInToolName => {
  return (BUILT_IN_TOOLS as ReadonlySet<string>).has(name);
};
