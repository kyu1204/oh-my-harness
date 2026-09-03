# Regenerating docs/demo.gif

```bash
brew install vhs                      # brings ttyd + ffmpeg
npm run build && npm link             # `omh` on PATH
omh config                            # any provider; init makes one LLM call

# throwaway project with one failing test
DEMO=$(mktemp -d)/acme-api && mkdir -p $DEMO/src && cd $DEMO
printf '{"name":"acme-api","type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^3"}}' > package.json
printf 'export function applyDiscount(p: number, pct: number) { return p - pct; }\n' > src/price.ts
printf 'import { test, expect } from "vitest";\nimport { applyDiscount } from "./price";\ntest("20%% off 50 is 40", () => expect(applyDiscount(50, 20)).toBe(40));\n' > src/price.test.ts
npm i --silent && git init -q && git add -A && git -c user.name=demo -c user.email=d@d commit -qm init

# `agent` fakes an AI agent's PreToolUse call into the generated hooks
cd - && DEMO_DIR=$DEMO PATH=$PWD/scripts/demo:$PATH vhs docs/demo.tape
```
