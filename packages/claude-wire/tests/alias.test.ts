import { describe, expect, test } from "bun:test";
import { ALIAS_PATTERN } from "@/process.js";

describe("ALIAS_PATTERN", () => {
  test("matches exported CLAUDE_CONFIG_DIR with double quotes", () => {
    const line = 'export CLAUDE_CONFIG_DIR="$HOME/.myconfig"';
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".myconfig");
  });

  test("matches exported CLAUDE_CONFIG_DIR with single quotes", () => {
    const line = "export CLAUDE_CONFIG_DIR='$HOME/.claude-work'";
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".claude-work");
  });

  test("matches export with no quotes", () => {
    const line = "export CLAUDE_CONFIG_DIR=$HOME/.bare\n";
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".bare");
  });

  test("matches export using ${HOME}", () => {
    const line = 'export CLAUDE_CONFIG_DIR="${HOME}/configs/a"';
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe("configs/a");
  });

  test("captures multi-segment paths", () => {
    const line = 'export CLAUDE_CONFIG_DIR="$HOME/.config/claude/work"';
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".config/claude/work");
  });

  test("matches alias with inline CLAUDE_CONFIG_DIR", () => {
    const line = 'alias claude="CLAUDE_CONFIG_DIR=$HOME/.alt claude"';
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".alt");
  });

  test("matches tilde form", () => {
    const line = 'export CLAUDE_CONFIG_DIR="~/.config-alt"';
    const match = line.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".config-alt");
  });

  test("returns null for unrelated lines", () => {
    expect("export FOO=bar".match(ALIAS_PATTERN)).toBeNull();
    expect("# just a comment".match(ALIAS_PATTERN)).toBeNull();
    expect("".match(ALIAS_PATTERN)).toBeNull();
  });

  test("does not match when value lacks $HOME/~ prefix", () => {
    const line = "export CLAUDE_CONFIG_DIR=/etc/claude";
    expect(line.match(ALIAS_PATTERN)).toBeNull();
  });

  test("ignores commented-out aliases", () => {
    const content = '# export CLAUDE_CONFIG_DIR="$HOME/.commented"\n';
    expect(content.match(ALIAS_PATTERN)).toBeNull();
  });

  test("ignores commented line even with leading whitespace", () => {
    const content = '  # export CLAUDE_CONFIG_DIR="$HOME/.indented-comment"\n';
    expect(content.match(ALIAS_PATTERN)).toBeNull();
  });

  test("matches active line in a multi-line file containing comments", () => {
    const content = ['# old config', '# export CLAUDE_CONFIG_DIR="$HOME/.old"', 'export CLAUDE_CONFIG_DIR="$HOME/.new"'].join("\n");
    const match = content.match(ALIAS_PATTERN);
    expect(match?.[1]).toBe(".new");
  });
});
