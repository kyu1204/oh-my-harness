# How it works

```text
  ~/.omh/config.json   ┌─────────────────────┐
  ┌────────────────┐   │                     │
  │ • Claude       │──▶│   NL Processing     │◀── "React + FastAPI
  │ • OpenAI       │   │   (describe your    │     TDD enforced"
  │ • Gemini       │   │                     │
  │ • Codex        │   │                     │
  │ • OpenRouter   │   │                     │
  │ • OpenAI-compat│   │                     │
  │   (local LLMs) │   └────────┬────────────┘
  └────────────────┘            │
   (global AI config)   ┌────────▼────────────┐
                        │  Project Detector   │  ← Auto-detects language,
                        │  (14 languages)     │    framework, package manager
                        └────────┬────────────┘
                                 │
                        ┌────────▼────────────┐
                        │   harness.yaml      │  ← Source of truth
                        │   (editable, git    │    (hooks + rules)
                        │    trackable)       │
                        └────────┬────────────┘
                                 │
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
            ┌──────────┐  ┌──────────┐  ┌──────────┐
            │CLAUDE.md │  │  Hooks   │  │settings. │
            │ (rules)  │  │(enforce) │  │  json    │
            │          │  │          │  │(perms)   │
            └──────────┘  └──────────┘  └──────────┘
```

## 🔍 Project Detector

oh-my-harness automatically detects your project type and injects accurate facts into the LLM prompt:

| Language | Detection | Commands |
|----------|-----------|----------|
| 🟦 TypeScript/JS | package.json, tsconfig | pnpm/npm/yarn test, eslint, tsc |
| 🐍 Python | pyproject.toml, requirements.txt, Pipfile, manage.py, .python-version | pytest, ruff, black, isort, mypy |
| 🍎 Swift | Package.swift, .xcodeproj | swift test, xcodebuild |
| 🦀 Rust | Cargo.toml | cargo test, cargo clippy |
| 🐹 Go | go.mod | go test, golangci-lint |
| ☕ Java/Kotlin | pom.xml, build.gradle | mvn test, ./gradlew test |
| 💎 Ruby | Gemfile | bundle exec rspec |
| 🐘 PHP | composer.json | phpunit |
| 🎯 Dart/Flutter | pubspec.yaml | dart test, flutter test |
| ⚡ C/C++ | CMakeLists.txt | cmake, make |
| 🟣 C#/.NET | *.csproj | dotnet test |
| 💧 Elixir | mix.exs | mix test |
| 🔷 Scala | build.sbt | sbt test |
| ⚡ Zig | build.zig | zig build test |

## 🤖 AI Provider Setup

Natural language mode (`omh init "description"`) needs one LLM call. Pick a provider once with `omh config`; it is saved globally in `~/.omh/config.json`.

| Provider | How to connect | Models |
|----------|----------------|--------|
| **Claude** | `claude` CLI (no key), or Anthropic API key | Live list from `/v1/models` (Sonnet 5 default) |
| **OpenAI** | API key | Live list from `/v1/models` (GPT-5.6 Sol default) |
| **Gemini** | API key | Live list from the Gemini API (2.5 Pro default) |
| **Codex** (ChatGPT subscription) | via the `codex` CLI (`codex login`), or direct API with device-code sign-in stored in `~/.omh` | Live list from your Codex account (GPT-5.6 Sol default) |
| **OpenRouter** | Sign in with browser (PKCE, creates a key on your account) or paste an API key | 300+ models incl. `:free` ones; `openrouter/auto` default |
| **OpenAI-compatible endpoint** | Base URL + optional key. Works with Ollama, llama.cpp server, MLX (`mlx_lm.server`), LM Studio, vLLM, and hosted OpenAI-compatible APIs (Groq, DeepSeek, xAI, Mistral, OrcaRouter, ...) | Whatever the server lists |

The model picker fetches the live model list from the provider when it can, falls back to a small built-in list otherwise, and always offers "Other (enter model id)", so new model releases never require an update of this tool. Long lists (OpenRouter) get a type-to-filter picker.

Browser sign-ins (Codex direct API, OpenRouter) open your default browser automatically and also print the URL as a bare clickable line, so it works over SSH or from a phone terminal. API keys and one-time codes are entered masked and stored with mode 0600.

```bash
omh config          # show current provider, then optionally reconfigure
omh config --show   # read-only
omh config --reset  # forget the saved provider
```

No saved config? `omh` falls back to `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, or `OPENROUTER_API_KEY` from the environment (handy in CI), and finally to the `claude` CLI.

Local example (Ollama):

```bash
ollama pull qwen2.5-coder:7b
omh config   # OpenAI-compatible endpoint -> http://localhost:11434/v1 -> empty key -> pick qwen2.5-coder:7b
```
