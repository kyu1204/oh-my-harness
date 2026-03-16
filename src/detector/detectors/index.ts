import type { Detector } from "../types.js";
import { nodeDetector } from "./node.js";
import { pythonDetector } from "./python.js";
import { swiftDetector } from "./swift.js";
import { goDetector } from "./go.js";
import { rustDetector } from "./rust.js";
import { javaDetector } from "./java.js";
import { cppDetector } from "./cpp.js";
import { dotnetDetector } from "./dotnet.js";
import { phpDetector } from "./php.js";
import { rubyDetector } from "./ruby.js";
import { dartDetector } from "./dart.js";
import { elixirDetector } from "./elixir.js";
import { scalaDetector } from "./scala.js";
import { zigDetector } from "./zig.js";

export const allDetectors: Detector[] = [
  nodeDetector,
  pythonDetector,
  swiftDetector,
  goDetector,
  rustDetector,
  javaDetector,
  cppDetector,
  dotnetDetector,
  phpDetector,
  rubyDetector,
  dartDetector,
  elixirDetector,
  scalaDetector,
  zigDetector,
];
