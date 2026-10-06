import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

// Screeps loads a single CommonJS module named "main" that must export `loop`.
export default {
  input: "src/main.ts",
  output: {
    file: "dist/main.js",
    format: "cjs",
    exports: "named",
  },
  plugins: [resolve(), commonjs(), typescript({ tsconfig: "./tsconfig.json" })],
};
