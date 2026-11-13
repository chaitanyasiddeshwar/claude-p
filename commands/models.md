---
description: List claude-p models (local + OpenRouter) matching a filter, e.g. /models deepseek
argument-hint: <filter words>
allowed-tools: Bash(node:*)
disable-model-invocation: false
---
!`node "{{MODELS_JS}}" $ARGUMENTS`

Show the list above to the user exactly as printed, in a code block, with no commentary except one line at the end: "Switch with: /model <id>". Do not call any tools.
