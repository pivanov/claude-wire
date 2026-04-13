// Best-effort snapshot of known Claude Code tools. May not be exhaustive.
// For the authoritative list, check session_meta.tools from a live session.
export const BUILT_IN_TOOLS = new Set([
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
  "TodoRead",
  "TodoWrite",
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
]);

export const isBuiltInTool = (name: string): boolean => {
  return BUILT_IN_TOOLS.has(name);
};
