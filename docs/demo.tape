# Regenerate docs/demo.gif:  vhs docs/demo.tape
# Needs: vhs (brew install vhs), a configured omh provider (omh config),
# and a scratch project in $DEMO_DIR with `omh` + `agent` shims on PATH
# (see scripts/demo/README.md).
Output docs/demo.gif

Set Shell bash
Set FontSize 15
Set Width 960
Set Height 560
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set CursorBlink false

Hide
Type "cd $DEMO_DIR && clear"
Enter
Show

Sleep 500ms
Type `omh init -y "TypeScript API, TDD enforced, block dangerous commands"`
Sleep 800ms
Enter
Hide
Wait+Screen@60s /initialized successfully/
Show
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "# Now let an AI agent try to misbehave..."
Enter
Sleep 800ms

Type `agent run 'git commit -m "add discount"'`
Enter
Wait+Screen@30s /BLOCKED|allowed/
Sleep 2s

Type "agent run 'rm -rf /'"
Enter
Sleep 1500ms

Type "agent edit src/price.ts"
Enter
Sleep 1500ms

Type "agent edit src/price.test.ts"
Enter
Sleep 3500ms
