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
]);

export const isBuiltInTool = (name: string): boolean => {
  return BUILT_IN_TOOLS.has(name);
};
